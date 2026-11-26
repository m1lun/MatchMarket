import type { Server } from 'node:http';

import request from 'supertest';

import type { GeoPoint } from '../../src/shared/models/common';
import { ME, bearer, clearDealData, makeUser } from '../helpers/dealFixtures';
import { expectServerError, rejecting } from '../helpers/storeFailures';
import { startTestApp, stopTestApp } from '../helpers/testApp';
import { createTestStore, type TestStore } from '../helpers/testStore';

let mongo: TestStore;
let app: Server;

const STORED_HOME: { address: string; location: GeoPoint } = {
  address: '2329 West Mall, Vancouver',
  location: { type: 'Point', coordinates: [-123.25, 49.26] },
};

beforeAll(async () => {
  mongo = await createTestStore();
  app = await startTestApp(mongo.store);
});

afterAll(async () => {
  await stopTestApp(app);
  await mongo.dropAndClose();
});

beforeEach(async () => {
  await clearDealData(mongo.db);
  await makeUser(mongo.store, ME, 'Terry', 'Teh');
  await mongo.store.users.updateAddress(ME, STORED_HOME);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Interface GET /api/users/me
describe('Mocked: GET /api/users/me', () => {
  // Mocked behavior: users.findById rejects with Error('MongoDB is unreachable')
  // Input: GET as ME, who has a saved profile
  // Expected status code: 500
  // Expected behavior: the error is handled and findById is called once
  // Expected output: { error: 'Internal Server Error' }
  test('users.findById Throws: 500', async () => {
    const findById = rejecting(mongo.store.users, 'findById');

    const response = await request(app).get('/api/users/me').set('Authorization', bearer(ME));

    expectServerError(response, findById);
  });
});

// Interface PATCH /api/users/me
describe('Mocked: PATCH /api/users/me', () => {
  // Mocked behavior: users.updateAddress rejects with Error('MongoDB is unreachable')
  // Input: { address: '6335 Thunderbird Crescent', location: { longitude: -123.24, latitude: 49.25 } } from ME
  // Expected status code: 500
  // Expected behavior: the error is handled, updateAddress is called once, and the saved address is unchanged
  // Expected output: { error: 'Internal Server Error' }
  test('users.updateAddress Throws: 500', async () => {
    const updateAddress = rejecting(mongo.store.users, 'updateAddress');

    const response = await request(app)
      .patch('/api/users/me')
      .set('Authorization', bearer(ME))
      .send({ address: '6335 Thunderbird Crescent', location: { longitude: -123.24, latitude: 49.25 } });

    expectServerError(response, updateAddress);
    expect(await mongo.db.collection('users').findOne({ id: ME }, { projection: { _id: 0, address: 1, location: 1 } })).toStrictEqual(
      STORED_HOME,
    );
  });
});
