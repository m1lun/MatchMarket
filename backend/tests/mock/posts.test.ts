import type { Server } from 'node:http';

import request from 'supertest';

import type { PostDoc } from '../../src/store/types';
import { ME, bearer } from '../helpers/dealFixtures';
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
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const FAILURE = new Error('MongoDB is unreachable');
const SERVER_ERROR = { error: 'Internal Server Error' };

type Target = 'post' | 'options' | 'customFields';

interface FailureCase {
  label: string;
  target: Target;
  method: string;
}

function storeOf(kind: PostKind, target: Target): object {
  if (target === 'options') {
    return mongo.store.options;
  }
  return target === 'customFields' ? mongo.store.customFields : kind.collectionOf(mongo.store);
}

// Makes one store method reject, as if MongoDB went away during the request.
function rejecting(kind: PostKind, { target, method }: FailureCase): jest.SpyInstance {
  const spy = jest.spyOn(storeOf(kind, target), method as never) as unknown as jest.SpyInstance;
  return spy.mockRejectedValue(FAILURE);
}

function as(call: request.Test): request.Test {
  return call.set('Authorization', bearer(ME));
}

function storedCount(kind: PostKind): Promise<number> {
  return countIn(mongo.db, kind.collection);
}

function stored(kind: PostKind, id: string): Promise<PostDoc | null> {
  return kind.collectionOf(mongo.store).findById(id);
}

// A body with a brand and a custom field, so saving it calls options.ensure and customFields.upsert.
function rememberingBody(kind: PostKind): Record<string, unknown> {
  return withFields(kind, [
    { kind: 'builtin', key: 'brand', value: 'IKEA' },
    { kind: 'custom', label: 'Material', type: 'text', value: 'oak' },
  ]);
}

function createTests(kind: PostKind): void {
  // Mocked behavior: the post collection's insert rejects with Error('MongoDB is unreachable')
  // Input: a valid body
  // Expected status code: 500
  // Expected behavior: the error is handled, insert is called once, and nothing is saved
  // Expected output: { error: 'Internal Server Error' }
  test('insert Throws: 500', async () => {
    const spy = rejecting(kind, { label: 'insert', target: 'post', method: 'insert' });

    const response = await as(request(app).post(kind.path)).send(rememberingBody(kind));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual(SERVER_ERROR);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await storedCount(kind)).toBe(0);
  });

  // Mocked behavior: options.ensure or customFields.upsert rejects with Error('MongoDB is unreachable') (see table)
  // Input: a valid body with a brand and a custom field
  // Expected status code: 500
  // Expected behavior: the post was already saved before its values are remembered, so it stays saved
  // Expected output: { error: 'Internal Server Error' }
  test.each<FailureCase>([
    { label: 'options.ensure', target: 'options', method: 'ensure' },
    { label: 'customFields.upsert', target: 'customFields', method: 'upsert' },
  ])('$label Throws: 500', async (failure: FailureCase) => {
    const spy = rejecting(kind, failure);

    const response = await as(request(app).post(kind.path)).send(rememberingBody(kind));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual(SERVER_ERROR);
    expect(spy).toHaveBeenCalled();
    expect(await storedCount(kind)).toBe(1);
  });
}

function listTests(kind: PostKind): void {
  // Mocked behavior: the post collection's listByOwner rejects with Error('MongoDB is unreachable')
  // Input: GET as ME, who has one post
  // Expected status code: 500
  // Expected behavior: the error is handled, listByOwner is called once, and the post is unchanged
  // Expected output: { error: 'Internal Server Error' }
  test('listByOwner Throws: 500', async () => {
    const post = await kind.make(mongo.store, ME);
    const spy = rejecting(kind, { label: 'listByOwner', target: 'post', method: 'listByOwner' });

    const response = await as(request(app).get(kind.path));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual(SERVER_ERROR);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await stored(kind, post.id)).toStrictEqual(post);
  });
}

function getOneTests(kind: PostKind): void {
  // Mocked behavior: the post collection's findById rejects with Error('MongoDB is unreachable')
  // Input: GET /:id of the caller's post
  // Expected status code: 500
  // Expected behavior: the error is handled and findById is called once
  // Expected output: { error: 'Internal Server Error' }
  test('findById Throws: 500', async () => {
    const post = await kind.make(mongo.store, ME);
    const spy = rejecting(kind, { label: 'findById', target: 'post', method: 'findById' });

    const response = await as(request(app).get(`${kind.path}/${post.id}`));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual(SERVER_ERROR);
    expect(spy).toHaveBeenCalledTimes(1);
  });
}

function patchTests(kind: PostKind): void {
  // Mocked behavior: the post collection's findById or replace rejects with Error('MongoDB is unreachable') (see table)
  // Input: PATCH /:id of the caller's post with { name: 'Renamed' }
  // Expected status code: 500
  // Expected behavior: the error is handled, the method is called once, and the post is unchanged
  // Expected output: { error: 'Internal Server Error' }
  test.each<FailureCase>([
    { label: 'findById', target: 'post', method: 'findById' },
    { label: 'replace', target: 'post', method: 'replace' },
  ])('$label Throws: 500', async (failure: FailureCase) => {
    const post = await kind.make(mongo.store, ME);
    const spy = rejecting(kind, failure);

    const response = await as(request(app).patch(`${kind.path}/${post.id}`)).send({ name: 'Renamed' });

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual(SERVER_ERROR);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(await stored(kind, post.id)).toStrictEqual(post);
  });

  // Mocked behavior: options.ensure rejects with Error('MongoDB is unreachable')
  // Input: PATCH /:id of the caller's post adding a brand and a new name
  // Expected status code: 500
  // Expected behavior: the edit was already saved before its values are remembered, so it stays saved
  // Expected output: { error: 'Internal Server Error' }
  test('options.ensure Throws: 500', async () => {
    const post = await kind.make(mongo.store, ME);
    const spy = rejecting(kind, { label: 'options.ensure', target: 'options', method: 'ensure' });
    const fields = fieldsWith(kind, [{ kind: 'builtin', key: 'brand', value: 'Muji' }]);

    const response = await as(request(app).patch(`${kind.path}/${post.id}`)).send({ name: 'Renamed', [kind.fieldsKey]: fields });

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual(SERVER_ERROR);
    expect(spy).toHaveBeenCalled();
    expect(asJson(await stored(kind, post.id))).toMatchObject({ name: 'Renamed' });
  });
}

function deleteTests(kind: PostKind): void {
  // Mocked behavior: the post collection's findById or remove rejects with Error('MongoDB is unreachable') (see table)
  // Input: DELETE /:id of the caller's post
  // Expected status code: 500
  // Expected behavior: the error is handled, the method is called once, and the post is kept
  // Expected output: { error: 'Internal Server Error' }
  test.each<FailureCase>([
    { label: 'findById', target: 'post', method: 'findById' },
    { label: 'remove', target: 'post', method: 'remove' },
  ])('$label Throws: 500', async (failure: FailureCase) => {
    const post = await kind.make(mongo.store, ME);
    const spy = rejecting(kind, failure);

    const response = await as(request(app).delete(`${kind.path}/${post.id}`));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual(SERVER_ERROR);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(await stored(kind, post.id)).toStrictEqual(post);
  });
}

// Interface POST /api/listings
describe('Mocked: POST /api/listings', () => {
  createTests(LISTING);
});

// Interface POST /api/requests
describe('Mocked: POST /api/requests', () => {
  createTests(REQUEST);
});

// Interface GET /api/listings
describe('Mocked: GET /api/listings', () => {
  listTests(LISTING);
});

// Interface GET /api/requests
describe('Mocked: GET /api/requests', () => {
  listTests(REQUEST);
});

// Interface GET /api/listings/:id
describe('Mocked: GET /api/listings/:id', () => {
  getOneTests(LISTING);
});

// Interface GET /api/requests/:id
describe('Mocked: GET /api/requests/:id', () => {
  getOneTests(REQUEST);
});

// Interface PATCH /api/listings/:id
describe('Mocked: PATCH /api/listings/:id', () => {
  patchTests(LISTING);
});

// Interface PATCH /api/requests/:id
describe('Mocked: PATCH /api/requests/:id', () => {
  patchTests(REQUEST);
});

// Interface DELETE /api/listings/:id
describe('Mocked: DELETE /api/listings/:id', () => {
  deleteTests(LISTING);
});

// Interface DELETE /api/requests/:id
describe('Mocked: DELETE /api/requests/:id', () => {
  deleteTests(REQUEST);
});
