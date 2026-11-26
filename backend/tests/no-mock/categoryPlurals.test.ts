import type { Server } from 'node:http';

import { ObjectId } from 'mongodb';
import request from 'supertest';

import { env } from '../../src/shared/config/env';
import { LISTINGS_COLLECTION } from '../../src/components/posts/models/listing';
import { OPTIONS_COLLECTION, type Option } from '../../src/components/posts/models/option';
import { normaliseStoredCategories, seedOptions } from '../../src/components/posts/store/seed';
import { ME, OTHER, PHOTO_ID, bearer, clearDealData, makeListing, makeRequest } from '../helpers/dealFixtures';
import { startTestApp, stopTestApp } from '../helpers/testApp';
import { createTestStore, type TestStore } from '../helpers/testStore';

let mongo: TestStore;
let app: Server;

beforeAll(async () => {
  mongo = await createTestStore();
  app = await startTestApp(mongo.store);
});

afterAll(async () => {
  await stopTestApp(app);
  await mongo.dropAndClose();
});

beforeEach(async () => {
  await Promise.all([clearDealData(mongo.db), mongo.db.collection(OPTIONS_COLLECTION).deleteMany({})]);
  // Without a key the feed never calls the routing service.
  jest.replaceProperty(env, 'orsApiKey', undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const LOCATION = { longitude: -123.25, latitude: 49.26 };

function listingBody(category: string): Record<string, unknown> {
  return {
    name: 'Oak desk',
    category,
    address: '6335 Thunderbird Crescent, Vancouver',
    description: 'Solid oak',
    location: LOCATION,
    photoIds: [PHOTO_ID],
    listingFields: [],
    price: 60,
    condition: 'good',
  };
}

function requestBody(category: string): Record<string, unknown> {
  return {
    name: 'Standing desk',
    category,
    address: '6335 Thunderbird Crescent, Vancouver',
    location: LOCATION,
    requestFields: [{ kind: 'builtin', key: 'price', value: 100, hard: true }],
  };
}

function post(path: string, body: object, userId = ME): request.Test {
  return request(app).post(path).set('Authorization', bearer(userId)).send(body);
}

function get(path: string, userId = ME): request.Test {
  return request(app).get(path).set('Authorization', bearer(userId));
}

async function categoryOptionKeys(): Promise<string[]> {
  const options = await mongo.store.options.list('category');
  return options.map((option) => option.key);
}

function categoryOption(key: string, builtin = false): Option {
  return { field: 'category', key, label: key, builtin, createdBy: null, createdAt: new Date() };
}

// Interface POST /api/listings
describe('Unmocked: POST /api/listings categories', () => {
  // Input: a listing created with each category
  // Expected status code: 201
  // Expected behavior: a simple plural is saved as its singular, and a word that only looks plural is unchanged
  // Expected output: the listing with the saved category
  test.each([
    ['desks', 'desk'],
    ['Desks', 'desk'],
    ['office chairs', 'office chair'],
    ['boxes', 'box'],
    ['benches', 'bench'],
    ['batteries', 'battery'],
    ['shoes', 'shoe'],
    ['shelves', 'shelf'],
    ['movies', 'movie'],
    ['desk', 'desk'],
    ['glass', 'glass'],
    ['glasses', 'glass'],
    ['electronics', 'electronics'],
    ['sports', 'sports'],
    ['jeans', 'jeans'],
    ['lens', 'lens'],
    ['canvas', 'canvas'],
    ['cactus', 'cactus'],
    ['tennis', 'tennis'],
    ['gas', 'gas'],
    ['furniture', 'furniture'],
  ])('Category %s Is Saved As %s', async (typed, saved) => {
    const response = await post('/api/listings', listingBody(typed));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ category: saved });
  });

  // Input: a listing created as desks
  // Expected status code: 201
  // Expected behavior: its category is remembered once, in the singular
  // Expected output: desk is offered as a category option, and desks is not
  test('Category Option Is Saved As The Singular', async () => {
    const response = await post('/api/listings', listingBody('Desks'));

    expect(response.status).toBe(201);
    expect(await categoryOptionKeys()).toEqual(['desk']);
  });
});

// Interface PATCH /api/listings/:id
describe('Unmocked: PATCH /api/listings/:id categories', () => {
  // Input: my listing edited to the category lamps
  // Expected status code: 200
  // Expected behavior: the edited category is saved as its singular
  // Expected output: the listing with category lamp
  test('Edited Category Is Saved As The Singular', async () => {
    const created = await post('/api/listings', listingBody('desk'));

    const response = await request(app)
      .patch(`/api/listings/${String(created.body.id)}`)
      .set('Authorization', bearer(ME))
      .send({ category: 'lamps' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ category: 'lamp' });
  });
});

// Interface POST /api/options
describe('Unmocked: POST /api/options', () => {
  // Input: the category option Desks
  // Expected status code: 201
  // Expected behavior: the option is saved in the singular
  // Expected output: an option with key and label desk
  test('Category Option Is Singular', async () => {
    const response = await post('/api/options', { field: 'category', label: 'Desks' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ field: 'category', key: 'desk', label: 'desk' });
  });

  // Input: the brand option Levis
  // Expected status code: 201
  // Expected behavior: only categories become singular, so a brand keeps its name
  // Expected output: an option with key levis and label Levis
  test('Other Options Are Unchanged', async () => {
    const response = await post('/api/options', { field: 'brand', label: 'Levis' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ field: 'brand', key: 'levis', label: 'Levis' });
  });
});

// Interface GET /api/options
describe('Unmocked: GET /api/options', () => {
  // Input: the built-in options, then a listing created as books
  // Expected status code: 200
  // Expected behavior: the built-in categories are singular unless they only look plural, so nothing is listed twice
  // Expected output: book once, with no books, and electronics and sports unchanged
  test('Built-In Categories Are Not Listed Twice', async () => {
    await seedOptions(mongo.store);
    await post('/api/listings', listingBody('books'));

    const response = await get('/api/options?field=category');

    expect(response.status).toBe(200);
    expect((response.body as Option[]).map((option) => option.key).sort()).toEqual([
      'book',
      'clothing',
      'electronics',
      'furniture',
      'other',
      'sports',
    ]);
  });
});

// Interface GET /api/feed
describe('Unmocked: GET /api/feed categories', () => {
  // Input: my request for a desk, and another user's listing created as desks
  // Expected status code: 200
  // Expected behavior: nothing is written
  // Expected output: the listing is a match
  test('Request For Desk Matches Listing Created As Desks', async () => {
    const source = await post('/api/requests', requestBody('desk'));
    const listing = await post('/api/listings', listingBody('desks'), OTHER);

    const response = await get(`/api/feed?postId=${String(source.body.id)}`);

    expect(response.status).toBe(200);
    expect(response.body.matches).toMatchObject([{ post: { id: listing.body.id } }]);
  });

  // Input: my request for desks, and another user's listing created as desk
  // Expected status code: 200
  // Expected behavior: nothing is written
  // Expected output: the listing is a match
  test('Request For Desks Matches Listing Created As Desk', async () => {
    const source = await post('/api/requests', requestBody('Desks'));
    const listing = await post('/api/listings', listingBody('desk'), OTHER);

    const response = await get(`/api/feed?postId=${String(source.body.id)}`);

    expect(response.status).toBe(200);
    expect(response.body.matches).toMatchObject([{ post: { id: listing.body.id } }]);
  });
});

// Interface GET /api/feed/listings
describe('Unmocked: GET /api/feed/listings categories', () => {
  // Input: another user's listing created as desk, and a category filter of desks
  // Expected status code: 200
  // Expected behavior: the filter is compared the same way as saved categories
  // Expected output: the listing
  test('Plural Filter Finds The Singular Category', async () => {
    const listing = await post('/api/listings', listingBody('desk'), OTHER);

    const response = await get('/api/feed/listings?category=desks');

    expect(response.status).toBe(200);
    expect(response.body.listings).toMatchObject([{ id: listing.body.id }]);
  });
});

// Runs at start-up, so no HTTP interface reaches it.
describe('Unmocked: normaliseStoredCategories', () => {
  // A post stored before this rule: saved normally, then its category set back to a plural.
  async function setStoredCategory(listingId: string, category: string): Promise<void> {
    await mongo.db.collection(LISTINGS_COLLECTION).updateOne({ _id: new ObjectId(listingId) }, { $set: { category } });
  }

  // Input: a stored listing with the category desks, and my request for a desk
  // Expected status code: 200 from GET /api/feed after normaliseStoredCategories runs
  // Expected behavior: the stored listing becomes desk, so the feed finds it
  // Expected output: the listing is a match, with category desk
  test('Stored Plural Post Becomes A Match', async () => {
    const listing = await makeListing(mongo.store, OTHER);
    await setStoredCategory(listing.id, 'desks');
    const source = await makeRequest(mongo.store, ME, { category: 'desk' });

    await normaliseStoredCategories(mongo.store);
    const response = await get(`/api/feed?postId=${source.id}`);

    expect(response.status).toBe(200);
    expect(response.body.matches).toMatchObject([{ post: { id: listing.id, category: 'desk' } }]);
  });

  // Input: a stored listing with a plural category and no name, which the validator would now reject
  // Expected status code: none, since normaliseStoredCategories runs at start-up rather than on a request
  // Expected behavior: it is still renamed, so an old post can't stop the backend starting
  // Expected output: the stored category is desk
  test('Post That Fails The Validator Is Still Renamed', async () => {
    const listing = await makeListing(mongo.store, OTHER);
    await mongo.db
      .collection(LISTINGS_COLLECTION)
      .updateOne(
        { _id: new ObjectId(listing.id) },
        { $set: { category: 'desks' }, $unset: { name: '' } },
        { bypassDocumentValidation: true },
      );

    await normaliseStoredCategories(mongo.store);

    const stored = await mongo.db.collection(LISTINGS_COLLECTION).findOne({ _id: new ObjectId(listing.id) });
    expect(stored?.category).toBe('desk');
  });

  // Input: stored options books (built-in), desks and desk, and a stored word that only looks plural
  // Expected status code: none, since normaliseStoredCategories runs at start-up rather than on a request
  // Expected behavior: plural options become singular, merging with one that already exists
  // Expected output: book, desk and electronics, with book still built-in
  test('Stored Plural Options Are Merged', async () => {
    await mongo.store.options.ensureMany([
      categoryOption('books', true),
      categoryOption('desks'),
      categoryOption('desk'),
      categoryOption('electronics', true),
    ]);

    await normaliseStoredCategories(mongo.store);

    expect(await categoryOptionKeys()).toEqual(['book', 'desk', 'electronics']);
    const options = await mongo.store.options.list('category');
    expect(options.find((option) => option.key === 'book')).toMatchObject({ label: 'book', builtin: true });
  });

  // Input: stored plural options for another field
  // Expected status code: none, since normaliseStoredCategories runs at start-up rather than on a request
  // Expected behavior: only categories change
  // Expected output: the brand option is unchanged
  test('Other Options Are Left Alone', async () => {
    await mongo.store.options.ensure({ ...categoryOption('levis'), field: 'brand', label: 'Levis' });

    await normaliseStoredCategories(mongo.store);

    expect(await mongo.store.options.list('brand')).toMatchObject([{ key: 'levis', label: 'Levis' }]);
  });

  // Input: a stored plural listing and option, normalised twice
  // Expected status code: none, since normaliseStoredCategories runs at start-up rather than on a request
  // Expected behavior: it runs on every start, so a second run changes nothing
  // Expected output: the same category and option after both runs
  test('Running Twice Changes Nothing', async () => {
    const listing = await makeListing(mongo.store, OTHER);
    await setStoredCategory(listing.id, 'desks');
    await mongo.store.options.ensure(categoryOption('desks'));

    await normaliseStoredCategories(mongo.store);
    await normaliseStoredCategories(mongo.store);

    expect(await categoryOptionKeys()).toEqual(['desk']);
    expect(await mongo.store.listings.findById(listing.id)).toMatchObject({ category: 'desk' });
  });
});
