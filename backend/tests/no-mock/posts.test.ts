import type { Server } from 'node:http';

import request from 'supertest';

import { MAX_NAME_LENGTH, MAX_PHOTOS } from '../../src/models/common';
import type { PostDoc } from '../../src/store/types';
import { ME, OTHER, PHOTO_ID, bearer } from '../helpers/dealFixtures';
import { LISTING, REQUEST, asJson, clearPostData, countIn, fieldsWith, withFields, type PostKind } from '../helpers/postFixtures';
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
  await clearPostData(mongo.db);
});

type Body = Record<string, unknown>;

interface TokenCase { label: string; header: string | undefined; error: string }
interface InvalidCase { label: string; body: Body | unknown[]; details: string[] }
interface StatusCase { label: string; from: 'open' | 'closed'; to: 'open' | 'closed' }
interface IdCase { label: string; id: string }

const UNKNOWN_ID = '6ad40b88e74dd3678bfef8ff';
const MALFORMED_ID = 'not-an-id';
const CONDITIONS_ERROR = 'new, like new, good, fair, poor';
const MAX_PRICE_WITHOUT_HARD = { kind: 'builtin', key: 'price', value: 100 };

const TOKEN_CASES: TokenCase[] = [
  { label: 'No Token', header: undefined, error: 'Missing Authorization: Bearer <session token> header' },
  { label: 'Garbage Token', header: 'Bearer not-a-token', error: 'Invalid or expired session token' },
];

const NOT_FOUND_CASES: IdCase[] = [
  { label: 'Unknown Id', id: UNKNOWN_ID },
  { label: 'Malformed Id', id: MALFORMED_ID },
];

function as(call: request.Test, userId = ME): request.Test {
  return call.set('Authorization', bearer(userId));
}

function withHeader(call: request.Test, header: string | undefined): request.Test {
  return header === undefined ? call : call.set('Authorization', header);
}

function storedCount(kind: PostKind): Promise<number> {
  return countIn(mongo.db, kind.collection);
}

function stored(kind: PostKind, id: string): Promise<PostDoc | null> {
  return kind.collectionOf(mongo.store).findById(id);
}

async function optionLabels(field: string): Promise<string[]> {
  const found = (await mongo.db.collection('options').find({ field }).toArray()) as unknown as { label: string }[];
  return found.map((option) => option.label);
}

// The validation rules both kinds share. `index` is where an added field lands in the fields array.
function sharedInvalidCases(kind: PostKind): InvalidCase[] {
  const index = kind.baseFields.length;
  const fields = `${kind.fieldsKey}[${index}]`;
  return [
    { label: 'Body Is Not An Object', body: [], details: ['request body must be a JSON object'] },
    { label: 'Missing Name', body: kind.body({ name: undefined }), details: ['name is required'] },
    { label: 'Blank Name', body: kind.body({ name: '   ' }), details: ['name is required'] },
    {
      label: 'Name Too Long',
      body: kind.body({ name: 'a'.repeat(MAX_NAME_LENGTH + 1) }),
      details: [`name must be at most ${MAX_NAME_LENGTH} characters`],
    },
    { label: 'Missing Category', body: kind.body({ category: undefined }), details: ['category is required'] },
    { label: 'Missing Address', body: kind.body({ address: undefined }), details: ['address is required'] },
    { label: 'Description Not Text', body: kind.body({ description: 5 }), details: ['description must be a string'] },
    {
      label: 'Missing Location',
      body: kind.body({ location: undefined }),
      details: ['location must be { longitude, latitude }'],
    },
    {
      label: 'Location Out Of Range',
      body: kind.body({ location: { longitude: 200, latitude: 0 } }),
      details: ['location is out of range'],
    },
    {
      label: 'Malformed Photo Id',
      body: kind.body({ photoIds: ['not-a-photo'] }),
      details: ['photoIds must be an array of ids returned by POST /api/photos'],
    },
    {
      label: 'Too Many Photos',
      body: kind.body({ photoIds: Array.from({ length: MAX_PHOTOS + 1 }, () => PHOTO_ID) }),
      details: [`at most ${MAX_PHOTOS} photos are allowed`],
    },
    {
      label: 'Unknown Built-in Field',
      body: withFields(kind, [{ kind: 'builtin', key: 'weight', value: 3 }]),
      details: [`${fields} has an unknown field "weight"`],
    },
    {
      label: 'Negative Size',
      body: withFields(kind, [{ kind: 'builtin', key: 'dimensions', value: { width: -1, height: 1, depth: 1 } }]),
      details: [kind.sizeError],
    },
    {
      label: 'Custom Field Without Label',
      body: withFields(kind, [{ kind: 'custom', type: 'text', value: 'oak' }]),
      details: [`${fields} needs a label`],
    },
    {
      label: 'Custom Field Named Like A Built-in',
      body: withFields(kind, [{ kind: 'custom', label: 'Brand', type: 'text', value: 'ikea' }]),
      details: ['"Brand" is already a built-in field, so there is no need to add it as a custom field'],
    },
    {
      label: 'Duplicate Field',
      body: withFields(kind, [
        { kind: 'builtin', key: 'brand', value: 'ikea' },
        { kind: 'builtin', key: 'brand', value: 'muji' },
      ]),
      details: ['Duplicate field "brand"'],
    },
  ];
}

const LISTING_INVALID_CASES: InvalidCase[] = [
  { label: 'No Photos', body: LISTING.body({ photoIds: [] }), details: ['at least 1 photo is required'] },
  { label: 'Negative Price', body: LISTING.body({ price: -1 }), details: ['price must be a number of at least 0'] },
  { label: 'Price Not A Number', body: LISTING.body({ price: 'ten' }), details: ['price must be a number of at least 0'] },
  {
    label: 'Unknown Condition',
    body: LISTING.body({ condition: 'mint' }),
    details: [`condition must be one of: ${CONDITIONS_ERROR}`],
  },
  { label: 'Fields Not An Array', body: LISTING.body({ listingFields: 'brand' }), details: ['listingFields must be an array'] },
];

const REQUEST_INVALID_CASES: InvalidCase[] = [
  { label: 'No Max Price', body: REQUEST.body({ requestFields: [] }), details: ['a max price is required'] },
  {
    label: 'Negative Max Price',
    body: REQUEST.body({ requestFields: [{ kind: 'builtin', key: 'price', value: -5, hard: true }] }),
    details: ['max price must be at least 0', 'a max price is required'],
  },
  {
    label: 'Unknown Min Condition',
    body: withFields(REQUEST, [{ kind: 'builtin', key: 'condition', value: 'mint' }]),
    details: [`min condition must be one of: ${CONDITIONS_ERROR}`],
  },
  {
    // The route does not check `hard`; the database's schema rejects the field instead.
    label: 'Field Without Hard',
    body: REQUEST.body({ requestFields: [MAX_PRICE_WITHOUT_HARD] }),
    details: ['a field is outside its allowed values or length'],
  },
  {
    label: 'Fields Not An Array',
    body: REQUEST.body({ requestFields: 'price' }),
    details: ['requestFields must be an array', 'a max price is required'],
  },
];

function createTests(kind: PostKind, kindCases: InvalidCase[]): void {
  // Input: POST with no Authorization header, or with a token that is not a valid JWT (see table)
  // Expected status code: 401
  // Expected behavior: the request is rejected and nothing is saved
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ header, error }: TokenCase) => {
    const response = await withHeader(request(app).post(kind.path), header).send(kind.body());

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
    expect(await storedCount(kind)).toBe(0);
  });

  // Input: a valid body with a name, category, address, location and the fields this kind requires
  // Expected status code: 201
  // Expected behavior: the post is saved as open and owned by the caller
  // Expected output: the saved post, with its id, ownerId, status and matching createdAt and updatedAt
  test('Valid Post: 201', async () => {
    const body = kind.body();

    const response = await as(request(app).post(kind.path)).send(body);

    expect(response.status).toBe(201);
    const created = response.body as Body & { id: string; createdAt: string; updatedAt: string };
    expect(created).toMatchObject({ ownerId: ME, status: 'open', name: body.name, category: body.category });
    expect(created.createdAt).toBe(created.updatedAt);
    expect(asJson(await stored(kind, created.id))).toStrictEqual(created);
    expect(await storedCount(kind)).toBe(1);
  });

  // Input: a valid body with a brand and a custom text field "Material: oak"
  // Expected status code: 201
  // Expected behavior: the category, brand, custom value and custom field are saved for next time
  // Expected output: the saved post
  test('Remembers New Values: 201', async () => {
    const body = withFields(kind, [
      { kind: 'builtin', key: 'brand', value: 'IKEA' },
      { kind: 'custom', label: 'Material', type: 'text', value: 'oak' },
    ]);

    const response = await as(request(app).post(kind.path)).send(body);

    expect(response.status).toBe(201);
    expect(await optionLabels('category')).toStrictEqual(['desk']);
    expect(await optionLabels('brand')).toStrictEqual(['IKEA']);
    expect(await optionLabels('material')).toStrictEqual(['oak']);
    const customFields = await mongo.store.customFields.list(ME);
    expect(customFields).toMatchObject([{ ownerId: ME, key: 'material', label: 'Material', type: 'text' }]);
  });

  // Input: a body that breaks one validation rule (see table)
  // Expected status code: 400
  // Expected behavior: nothing is saved
  // Expected output: { error: 'Invalid request', details } naming every broken rule
  test.each([...sharedInvalidCases(kind), ...kindCases])('$label: 400', async ({ body, details }: InvalidCase) => {
    const response = await as(request(app).post(kind.path)).send(body as object);

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Invalid request', details });
    expect(await storedCount(kind)).toBe(0);
  });

  // Input: a body that is not valid JSON
  // Expected status code: 400
  // Expected behavior: nothing is saved
  // Expected output: { error: 'Malformed request body' }
  test('Malformed JSON: 400', async () => {
    const response = await as(request(app).post(kind.path)).set('Content-Type', 'application/json').send('{"name":');

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Malformed request body' });
    expect(await storedCount(kind)).toBe(0);
  });
}

function listTests(kind: PostKind): void {
  // Input: GET with no Authorization header, or with a token that is not a valid JWT (see table)
  // Expected status code: 401
  // Expected behavior: the request is rejected before the database is read
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ header, error }: TokenCase) => {
    const response = await withHeader(request(app).get(kind.path), header);

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
  });

  // Input: GET as a user with no posts of this kind
  // Expected status code: 200
  // Expected behavior: nothing is returned
  // Expected output: []
  test('No Posts: 200', async () => {
    const response = await as(request(app).get(kind.path));

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual([]);
  });

  // Input: GET as ME, who has an older closed post and a newer open one, while OTHER has an open post
  // Expected status code: 200
  // Expected behavior: only the caller's posts are returned, open and closed, newest first
  // Expected output: [newer open post, older closed post]
  test('Own Open And Closed Posts, Newest First: 200', async () => {
    const older = await kind.make(mongo.store, ME, { status: 'closed', createdAt: new Date('2026-01-01') } as Partial<PostDoc>);
    const newer = await kind.make(mongo.store, ME, { createdAt: new Date('2026-02-01') } as Partial<PostDoc>);
    await kind.make(mongo.store, OTHER);

    const response = await as(request(app).get(kind.path));

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual([asJson(newer), asJson(older)]);
  });
}

function getOneTests(kind: PostKind): void {
  // Input: GET /:id with no Authorization header, or with a token that is not a valid JWT (see table)
  // Expected status code: 401
  // Expected behavior: the request is rejected before the database is read
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ header, error }: TokenCase) => {
    const post = await kind.make(mongo.store, ME);

    const response = await withHeader(request(app).get(`${kind.path}/${post.id}`), header);

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
  });

  // Input: GET /:id of the caller's own open or closed post
  // Expected status code: 200
  // Expected behavior: the post is returned whatever its status
  // Expected output: the stored post
  test.each(['open', 'closed'] as const)('Own %s Post: 200', async (status) => {
    const post = await kind.make(mongo.store, ME, { status });

    const response = await as(request(app).get(`${kind.path}/${post.id}`));

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual(asJson(post));
  });

  // Input: GET /:id of OTHER's post
  // Expected status code: 403
  // Expected behavior: the post is not shown to anyone but its owner
  // Expected output: { error: 'Forbidden' }
  test("Another User's Post: 403", async () => {
    const post = await kind.make(mongo.store, OTHER);

    const response = await as(request(app).get(`${kind.path}/${post.id}`));

    expect(response.status).toBe(403);
    expect(response.body).toStrictEqual({ error: 'Forbidden' });
  });

  // Input: GET /:id with a well-formed id that matches no post, or with a malformed id (see table)
  // Expected status code: 404
  // Expected behavior: nothing is returned
  // Expected output: { error: 'Not Found' }
  test.each(NOT_FOUND_CASES)('$label: 404', async ({ id }: IdCase) => {
    const response = await as(request(app).get(`${kind.path}/${id}`));

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
  });
}

function patchTests(kind: PostKind): void {
  function patch(id: string, body: unknown, userId = ME): request.Test {
    return as(request(app).patch(`${kind.path}/${id}`), userId).send(body as object);
  }

  // Input: PATCH /:id with no Authorization header, or with a token that is not a valid JWT (see table)
  // Expected status code: 401
  // Expected behavior: the request is rejected and the post is unchanged
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ header, error }: TokenCase) => {
    const post = await kind.make(mongo.store, ME);

    const response = await withHeader(request(app).patch(`${kind.path}/${post.id}`), header).send({ name: 'Renamed' });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
    expect(await stored(kind, post.id)).toStrictEqual(post);
  });

  // Input: PATCH /:id of the caller's post with { name: 'Renamed' }
  // Expected status code: 200
  // Expected behavior: only the name and updatedAt change; every other field is kept
  // Expected output: the updated post
  test('Edit One Field: 200', async () => {
    const post = await kind.make(mongo.store, ME);

    const response = await patch(post.id, { name: 'Renamed' });

    expect(response.status).toBe(200);
    const { updatedAt, ...rest } = response.body as Body;
    const { updatedAt: oldUpdatedAt, ...oldRest } = asJson(post) as Body;
    expect(rest).toStrictEqual({ ...oldRest, name: 'Renamed' });
    expect(new Date(updatedAt as string).getTime()).toBeGreaterThanOrEqual(new Date(oldUpdatedAt as string).getTime());
    expect(asJson(await stored(kind, post.id))).toStrictEqual(response.body);
  });

  // Input: PATCH /:id with { status } to close an open post or reopen a closed one (see table)
  // Expected status code: 200
  // Expected behavior: the stored status changes and the rest of the post is kept
  // Expected output: the post with its new status
  test.each<StatusCase>([
    { label: 'Close', from: 'open', to: 'closed' },
    { label: 'Reopen', from: 'closed', to: 'open' },
  ])('$label: 200', async ({ from, to }: StatusCase) => {
    const post = await kind.make(mongo.store, ME, { status: from });

    const response = await patch(post.id, { status: to });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: post.id, status: to, name: (post as unknown as Body).name });
    expect((await stored(kind, post.id))?.status).toBe(to);
  });

  // Input: PATCH /:id of a closed post with { name: 'Renamed' } and no status
  // Expected status code: 200
  // Expected behavior: the post is edited and stays closed
  // Expected output: the renamed post with status 'closed'
  test('Edit Closed Post: 200', async () => {
    const post = await kind.make(mongo.store, ME, { status: 'closed' });

    const response = await patch(post.id, { name: 'Renamed' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ name: 'Renamed', status: 'closed' });
  });

  // Input: PATCH /:id with server-set fields id, ownerId and createdAt alongside a new name
  // Expected status code: 200
  // Expected behavior: the server-set fields are ignored; only the name changes
  // Expected output: the post with its original id, ownerId and createdAt
  test('Server Fields Are Ignored: 200', async () => {
    const post = await kind.make(mongo.store, ME);
    const original = asJson(post) as Body;

    const response = await patch(post.id, { id: UNKNOWN_ID, ownerId: OTHER, createdAt: '2000-01-01T00:00:00.000Z', name: 'Renamed' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: post.id, ownerId: ME, createdAt: original.createdAt, name: 'Renamed' });
  });

  // Input: PATCH /:id adding a brand "Muji" that is not saved yet
  // Expected status code: 200
  // Expected behavior: the new brand is saved for next time
  // Expected output: the post with the brand field
  test('Remembers New Values: 200', async () => {
    const post = await kind.make(mongo.store, ME);

    const response = await patch(post.id, { [kind.fieldsKey]: fieldsWith(kind, [{ kind: 'builtin', key: 'brand', value: 'Muji' }]) });

    expect(response.status).toBe(200);
    expect(await optionLabels('brand')).toStrictEqual(['Muji']);
  });

  // Input: PATCH /:id with an unknown status, a body that is not an object, or a change that makes the post invalid (see table)
  // Expected status code: 400
  // Expected behavior: the post is unchanged
  // Expected output: { error: 'Invalid request', details } naming the problem
  test.each<InvalidCase>([
    { label: 'Unknown Status', body: { status: 'archived' }, details: ['status must be "open" or "closed"'] },
    { label: 'Body Is Not An Object', body: [], details: ['request body must be a JSON object'] },
    { label: 'Blank Name', body: { name: '' }, details: ['name is required'] },
  ])('$label: 400', async ({ body, details }: InvalidCase) => {
    const post = await kind.make(mongo.store, ME);

    const response = await patch(post.id, body);

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Invalid request', details });
    expect(await stored(kind, post.id)).toStrictEqual(post);
  });

  // Input: PATCH /:id of OTHER's post with { name: 'Renamed' }
  // Expected status code: 403
  // Expected behavior: the post is unchanged
  // Expected output: { error: 'Forbidden' }
  test("Another User's Post: 403", async () => {
    const post = await kind.make(mongo.store, OTHER);

    const response = await patch(post.id, { name: 'Renamed' });

    expect(response.status).toBe(403);
    expect(response.body).toStrictEqual({ error: 'Forbidden' });
    expect(await stored(kind, post.id)).toStrictEqual(post);
  });

  // Input: PATCH /:id with a well-formed id that matches no post, or with a malformed id (see table)
  // Expected status code: 404
  // Expected behavior: nothing is saved
  // Expected output: { error: 'Not Found' }
  test.each(NOT_FOUND_CASES)('$label: 404', async ({ id }: IdCase) => {
    const response = await patch(id, { name: 'Renamed' });

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
    expect(await storedCount(kind)).toBe(0);
  });
}

function deleteTests(kind: PostKind): void {
  function remove(id: string): request.Test {
    return as(request(app).delete(`${kind.path}/${id}`));
  }

  // Input: DELETE /:id with no Authorization header, or with a token that is not a valid JWT (see table)
  // Expected status code: 401
  // Expected behavior: the request is rejected and the post is kept
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ header, error }: TokenCase) => {
    const post = await kind.make(mongo.store, ME);

    const response = await withHeader(request(app).delete(`${kind.path}/${post.id}`), header);

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
    expect(await stored(kind, post.id)).toStrictEqual(post);
  });

  // Input: DELETE /:id of the caller's post, then the same DELETE again
  // Expected status code: 204, then 404
  // Expected behavior: the post is removed; the second delete finds nothing
  // Expected output: an empty body, then { error: 'Not Found' }
  test('Own Post: 204, Then 404', async () => {
    const post = await kind.make(mongo.store, ME);

    const response = await remove(post.id);
    const again = await remove(post.id);

    expect(response.status).toBe(204);
    expect(response.body).toStrictEqual({});
    expect(await stored(kind, post.id)).toBeNull();
    expect(again.status).toBe(404);
    expect(again.body).toStrictEqual({ error: 'Not Found' });
  });

  // Input: DELETE /:id of OTHER's post
  // Expected status code: 403
  // Expected behavior: the post is kept
  // Expected output: { error: 'Forbidden' }
  test("Another User's Post: 403", async () => {
    const post = await kind.make(mongo.store, OTHER);

    const response = await remove(post.id);

    expect(response.status).toBe(403);
    expect(response.body).toStrictEqual({ error: 'Forbidden' });
    expect(await stored(kind, post.id)).toStrictEqual(post);
  });

  // Input: DELETE /:id with a well-formed id that matches no post, or with a malformed id (see table)
  // Expected status code: 404
  // Expected behavior: nothing is removed
  // Expected output: { error: 'Not Found' }
  test.each(NOT_FOUND_CASES)('$label: 404', async ({ id }: IdCase) => {
    await kind.make(mongo.store, ME);

    const response = await remove(id);

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
    expect(await storedCount(kind)).toBe(1);
  });
}

// Interface POST /api/listings
describe('Unmocked: POST /api/listings', () => {
  createTests(LISTING, LISTING_INVALID_CASES);
});

// Interface POST /api/requests
describe('Unmocked: POST /api/requests', () => {
  createTests(REQUEST, REQUEST_INVALID_CASES);
});

// Interface GET /api/listings
describe('Unmocked: GET /api/listings', () => {
  listTests(LISTING);
});

// Interface GET /api/requests
describe('Unmocked: GET /api/requests', () => {
  listTests(REQUEST);
});

// Interface GET /api/listings/:id
describe('Unmocked: GET /api/listings/:id', () => {
  getOneTests(LISTING);
});

// Interface GET /api/requests/:id
describe('Unmocked: GET /api/requests/:id', () => {
  getOneTests(REQUEST);
});

// Interface PATCH /api/listings/:id
describe('Unmocked: PATCH /api/listings/:id', () => {
  patchTests(LISTING);
});

// Interface PATCH /api/requests/:id
describe('Unmocked: PATCH /api/requests/:id', () => {
  patchTests(REQUEST);
});

// Interface DELETE /api/listings/:id
describe('Unmocked: DELETE /api/listings/:id', () => {
  deleteTests(LISTING);
});

// Interface DELETE /api/requests/:id
describe('Unmocked: DELETE /api/requests/:id', () => {
  deleteTests(REQUEST);
});
