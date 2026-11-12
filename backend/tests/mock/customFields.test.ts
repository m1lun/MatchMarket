import type { Server } from 'node:http';

import request from 'supertest';

import { ME, bearer } from '../helpers/dealFixtures';
import { clearPostData, countIn } from '../helpers/postFixtures';
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

function as(call: request.Test): request.Test {
  return call.set('Authorization', bearer(ME));
}

// Interface GET /api/custom-fields
describe('Mocked: GET /api/custom-fields', () => {
  // Mocked behavior: customFields.list rejects with Error('MongoDB is unreachable')
  // Input: GET /api/custom-fields
  // Expected status code: 500
  // Expected behavior: the error is handled and list is called once
  // Expected output: { error: 'Internal Server Error' }
  test('customFields.list Throws: 500', async () => {
    const spy = jest.spyOn(mongo.store.customFields, 'list').mockRejectedValue(FAILURE);

    const response = await as(request(app).get('/api/custom-fields'));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual(SERVER_ERROR);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// Interface POST /api/custom-fields
describe('Mocked: POST /api/custom-fields', () => {
  // Mocked behavior: customFields.list or customFields.upsert rejects with Error('MongoDB is unreachable') (see table)
  // Input: { label: 'Material', type: 'text' }
  // Expected status code: 500
  // Expected behavior: the error is handled, the method is called once, and nothing is saved
  // Expected output: { error: 'Internal Server Error' }
  test.each(['list', 'upsert'] as const)('customFields.%s Throws: 500', async (method) => {
    const spy = jest.spyOn(mongo.store.customFields, method).mockRejectedValue(FAILURE);

    const response = await as(request(app).post('/api/custom-fields')).send({ label: 'Material', type: 'text' });

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual(SERVER_ERROR);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await countIn(mongo.db, 'customFields')).toBe(0);
  });
});

// Interface DELETE /api/custom-fields/:key
describe('Mocked: DELETE /api/custom-fields/:key', () => {
  // Mocked behavior: customFields.remove rejects with Error('MongoDB is unreachable')
  // Input: DELETE /api/custom-fields/material for the caller's "Material" field
  // Expected status code: 500
  // Expected behavior: the error is handled, remove is called once, and the field is kept
  // Expected output: { error: 'Internal Server Error' }
  test('customFields.remove Throws: 500', async () => {
    await mongo.store.customFields.upsert({ ownerId: ME, key: 'material', label: 'Material', type: 'text' });
    const spy = jest.spyOn(mongo.store.customFields, 'remove').mockRejectedValue(FAILURE);

    const response = await as(request(app).delete('/api/custom-fields/material'));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual(SERVER_ERROR);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await countIn(mongo.db, 'customFields')).toBe(1);
  });
});
