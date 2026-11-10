import type { Server } from 'node:http';

import request from 'supertest';

import type { Store } from '../../src/store/types';
import { ME, bearer, clearDealData } from '../helpers/dealFixtures';
import { startTestApp, stopTestApp } from '../helpers/testApp';
import { createTestStore, type TestStore } from '../helpers/testStore';

let mongo: TestStore;
let app: Server;

beforeAll(async () => {
  mongo = await createTestStore();
  app = await startTestApp(mongo.store, true);
});

afterAll(async () => {
  await stopTestApp(app);
  await mongo.dropAndClose();
});

beforeEach(async () => {
  await clearDealData(mongo.db);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const FAILURE = new Error('MongoDB is unreachable');

interface FailCase {
  label: string;
  method: 'post' | 'delete';
  spy: (store: Store) => jest.SpyInstance;
}

// Interfaces POST and DELETE /api/e2e/deals
describe('Mocked: POST and DELETE /api/e2e/deals', () => {
  // Mocked behavior: the store method named in each row rejects with Error('MongoDB is unreachable')
  // Input: POST or DELETE /api/e2e/deals as ME
  // Expected status code: 500
  // Expected behavior: the error is handled and the store method is called once
  // Expected output: { error: 'Internal Server Error' }
  test.each<FailCase>([
    { label: 'POST deals.removeBySellerAndBuyer', method: 'post', spy: (store) => jest.spyOn(store.deals, 'removeBySellerAndBuyer') },
    { label: 'DELETE deals.removeBySellerAndBuyer', method: 'delete', spy: (store) => jest.spyOn(store.deals, 'removeBySellerAndBuyer') },
  ])('$label Throws: 500', async ({ method, spy }: FailCase) => {
    const failing = spy(mongo.store).mockRejectedValue(FAILURE);

    const call = method === 'post' ? request(app).post('/api/e2e/deals') : request(app).delete('/api/e2e/deals');
    const response = await call.set('Authorization', bearer(ME));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
