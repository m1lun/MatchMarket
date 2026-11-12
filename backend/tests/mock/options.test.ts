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

// Interface GET /api/options
describe('Mocked: GET /api/options', () => {
  // Mocked behavior: options.list rejects with Error('MongoDB is unreachable')
  // Input: GET /api/options?field=brand
  // Expected status code: 500
  // Expected behavior: the error is handled and list is called once
  // Expected output: { error: 'Internal Server Error' }
  test('options.list Throws: 500', async () => {
    const spy = jest.spyOn(mongo.store.options, 'list').mockRejectedValue(FAILURE);

    const response = await as(request(app).get('/api/options?field=brand'));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual(SERVER_ERROR);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// Interface POST /api/options
describe('Mocked: POST /api/options', () => {
  // Mocked behavior: options.ensure rejects with Error('MongoDB is unreachable')
  // Input: { field: 'brand', label: 'IKEA' }
  // Expected status code: 500
  // Expected behavior: the error is handled, ensure is called once, and nothing is saved
  // Expected output: { error: 'Internal Server Error' }
  test('options.ensure Throws: 500', async () => {
    const spy = jest.spyOn(mongo.store.options, 'ensure').mockRejectedValue(FAILURE);

    const response = await as(request(app).post('/api/options')).send({ field: 'brand', label: 'IKEA' });

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual(SERVER_ERROR);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await countIn(mongo.db, 'options')).toBe(0);
  });
});
