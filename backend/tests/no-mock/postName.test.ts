import { ObjectId } from 'mongodb';
import request from 'supertest';

import { createApp } from '../../src/app';
import { MAX_NAME_LENGTH } from '../../src/shared/models/common';
import { LISTINGS_COLLECTION } from '../../src/components/posts/models/listing';
import { REQUESTS_COLLECTION } from '../../src/components/posts/models/request';
import { ME, OTHER, PHOTO_ID, bearer, makeListing } from '../helpers/dealFixtures';
import { MemorySessionRepo } from '../helpers/memorySessionRepo';
import { createTestStore, type TestStore } from '../helpers/testStore';

let mongo: TestStore;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  mongo = await createTestStore();
  app = createApp({ sessions: new MemorySessionRepo(), store: mongo.store });
});

afterAll(async () => {
  await mongo.dropAndClose();
});

beforeEach(async () => {
  await Promise.all([
    mongo.db.collection(LISTINGS_COLLECTION).deleteMany({}),
    mongo.db.collection(REQUESTS_COLLECTION).deleteMany({}),
  ]);
});

const LOCATION = { longitude: -123.25, latitude: 49.26 };

function listingBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'IKEA oak desk',
    category: 'desk',
    address: '6335 Thunderbird Crescent, Vancouver',
    description: 'Solid oak',
    location: LOCATION,
    photoIds: [PHOTO_ID],
    listingFields: [],
    price: 60,
    condition: 'good',
    ...overrides,
  };
}

function requestBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Standing desk',
    category: 'desk',
    address: '6335 Thunderbird Crescent, Vancouver',
    location: LOCATION,
    requestFields: [{ kind: 'builtin', key: 'price', value: 100, hard: true }],
    ...overrides,
  };
}

function post(path: string, body: unknown, userId = ME): request.Test {
  return request(app).post(path).set('Authorization', bearer(userId)).send(body as object);
}

function patch(path: string, body: unknown): request.Test {
  return request(app).patch(path).set('Authorization', bearer(ME)).send(body as object);
}

function get(path: string, userId = ME): request.Test {
  return request(app).get(path).set('Authorization', bearer(userId));
}

// A listing as it was stored before posts had names: saved normally, then its name removed.
// The validator would reject a listing without a name, so the update bypasses it.
async function insertUnnamedListing(ownerId = ME): Promise<string> {
  const listing = await makeListing(mongo.store, ownerId, { category: 'desk' });
  await mongo.db
    .collection(LISTINGS_COLLECTION)
    .updateOne({ _id: new ObjectId(listing.id) }, { $unset: { name: '' } }, { bypassDocumentValidation: true });
  return listing.id;
}

// Interface POST /api/listings
describe('Unmocked: POST /api/listings', () => {
  // Input: a listing whose name has spaces around it
  // Expected status code: 201
  // Expected behavior: the listing is saved with the trimmed name
  // Expected output: the listing, with name "IKEA oak desk"
  test('Name Is Trimmed', async () => {
    const response = await post('/api/listings', listingBody({ name: '  IKEA oak desk  ' }));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name: 'IKEA oak desk', category: 'desk' });
  });

  // Input: a name of exactly MAX_NAME_LENGTH characters
  // Expected status code: 201
  // Expected behavior: the listing is saved
  // Expected output: the listing, with the full name
  test('Name At Max Length', async () => {
    const name = 'a'.repeat(MAX_NAME_LENGTH);

    const response = await post('/api/listings', listingBody({ name }));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name });
  });

  // Input: a listing with no name, a blank name, or a name that is not a string
  // Expected status code: 400
  // Expected behavior: nothing is saved
  // Expected output: details include "name is required"
  test.each([
    { label: 'Missing', name: undefined },
    { label: 'Blank', name: '   ' },
    { label: 'Not A String', name: 42 },
  ])('$label Name: 400', async ({ name }: { label: string; name: unknown }) => {
    const response = await post('/api/listings', listingBody({ name }));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid request', details: ['name is required'] });
    expect(await mongo.db.collection(LISTINGS_COLLECTION).countDocuments()).toBe(0);
  });
});

// Interface POST /api/requests
describe('Unmocked: POST /api/requests', () => {
  // Input: a request with a name
  // Expected status code: 201
  // Expected behavior: the request is saved with its name
  // Expected output: the request, with name "Standing desk"
  test('Name Is Saved', async () => {
    const response = await post('/api/requests', requestBody());

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name: 'Standing desk' });
  });

  // Input: a request with a name one character too long
  // Expected status code: 400
  // Expected behavior: nothing is saved
  // Expected output: details say the name is too long
  test('Name Too Long: 400', async () => {
    const response = await post('/api/requests', requestBody({ name: 'a'.repeat(MAX_NAME_LENGTH + 1) }));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid request',
      details: [`name must be at most ${MAX_NAME_LENGTH} characters`],
    });
    expect(await mongo.db.collection(REQUESTS_COLLECTION).countDocuments()).toBe(0);
  });
});

// Interface PATCH /api/listings/:id
describe('Unmocked: PATCH /api/listings/:id', () => {
  // Input: a new name for one of my listings
  // Expected status code: 200
  // Expected behavior: the name is updated
  // Expected output: the listing, with the new name
  test('Rename', async () => {
    const created = await post('/api/listings', listingBody());

    const response = await patch(`/api/listings/${String(created.body.id)}`, { name: ' Oak desk, barely used ' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ name: 'Oak desk, barely used' });
  });

  // Input: a change to the price only
  // Expected status code: 200
  // Expected behavior: the name is kept
  // Expected output: the listing, with its original name
  test('Name Kept When Other Fields Change', async () => {
    const created = await post('/api/listings', listingBody());

    const response = await patch(`/api/listings/${String(created.body.id)}`, { price: 45 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ name: 'IKEA oak desk', price: 45 });
  });

  // Input: a blank name
  // Expected status code: 400
  // Expected behavior: the stored name is unchanged
  // Expected output: details include "name is required"
  test('Blank Name: 400', async () => {
    const created = await post('/api/listings', listingBody());
    const id = String(created.body.id);

    const response = await patch(`/api/listings/${id}`, { name: '' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid request', details: ['name is required'] });
    expect((await get(`/api/listings/${id}`)).body).toMatchObject({ name: 'IKEA oak desk' });
  });

  // Input: a price change on a listing saved before posts had names
  // Expected status code: 200
  // Expected behavior: the listing passes validation and is saved with its category as its name
  // Expected output: the listing, with the new price and name "desk"
  test('Post Without A Stored Name', async () => {
    const id = await insertUnnamedListing();

    const response = await patch(`/api/listings/${id}`, { price: 45 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ name: 'desk', price: 45 });
    expect(await mongo.db.collection(LISTINGS_COLLECTION).findOne({ _id: new ObjectId(id) })).toMatchObject({ name: 'desk' });
  });
});

// Interface GET /api/listings
describe('Unmocked: GET /api/listings', () => {
  // Input: my listings, one saved with a name and one saved before posts had names
  // Expected status code: 200
  // Expected behavior: nothing is written
  // Expected output: each listing with its name, or its category where it has none
  test('Names And Post Without A Stored Name', async () => {
    const unnamedId = await insertUnnamedListing();
    const named = await post('/api/listings', listingBody());

    const response = await get('/api/listings');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject([
      { id: named.body.id, name: 'IKEA oak desk' },
      { id: unnamedId, name: 'desk' },
    ]);
  });
});

// Interface GET /api/listings/:id
describe('Unmocked: GET /api/listings/:id', () => {
  // Input: the id of a listing saved before posts had names
  // Expected status code: 200
  // Expected behavior: nothing is written
  // Expected output: the listing, with its category as its name
  test('Post Without A Stored Name', async () => {
    const id = await insertUnnamedListing();

    const response = await get(`/api/listings/${id}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id, name: 'desk' });
  });
});

// Interface GET /api/feed/listings
describe('Unmocked: GET /api/feed/listings', () => {
  // Input: another user's listings, one saved with a name and one saved before posts had names
  // Expected status code: 200
  // Expected behavior: nothing is written
  // Expected output: each listing with its name, or its category where it has none
  test('Names And Post Without A Stored Name', async () => {
    const unnamedId = await insertUnnamedListing(OTHER);
    const named = await post('/api/listings', listingBody(), OTHER);

    const response = await get('/api/feed/listings');

    expect(response.status).toBe(200);
    expect(response.body.listings).toMatchObject([
      { id: named.body.id, name: 'IKEA oak desk' },
      { id: unnamedId, name: 'desk' },
    ]);
  });
});

// Interface GET /api/feed
describe('Unmocked: GET /api/feed', () => {
  // Input: my request for a desk, and another user's matching desk listing
  // Expected status code: 200
  // Expected behavior: nothing is written
  // Expected output: the matching listing, with its name
  test('Match Has A Name', async () => {
    const source = await post('/api/requests', requestBody());
    const listing = await post('/api/listings', listingBody(), OTHER);

    const response = await get(`/api/feed?postId=${String(source.body.id)}`);

    expect(response.status).toBe(200);
    expect(response.body.matches).toMatchObject([{ post: { id: listing.body.id, name: 'IKEA oak desk' } }]);
  });
});
