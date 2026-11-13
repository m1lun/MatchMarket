import type { Server } from 'node:http';

import request from 'supertest';

import type { Store } from '../../src/store/types';
import { ME, bearer } from '../helpers/dealFixtures';
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
  await Promise.all(
    ['listings', 'users', 'conversations', 'messages'].map(async (name) => {
      await mongo.db.collection(name).deleteMany({});
    })
  );
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const FAILURE = new Error('MongoDB is unreachable');

interface FailCase {
  label: string;
  method: 'post' | 'delete';
  path: string;
  spy: (store: Store) => jest.SpyInstance;
}

// Interfaces POST /api/e2e/listings, POST and DELETE /api/e2e/conversations
describe('Mocked: POST /api/e2e/listings, POST and DELETE /api/e2e/conversations', () => {
  // Mocked behavior: the store method named in each row rejects with Error('MongoDB is unreachable')
  // Input: the route named in each row, as ME
  // Expected status code: 500
  // Expected behavior: the error is handled and the store method is called once
  // Expected output: { error: 'Internal Server Error' }
  test.each<FailCase>([
    { label: 'POST listings: listings.insert', method: 'post', path: '/api/e2e/listings', spy: (store) => jest.spyOn(store.listings, 'insert') },
    { label: 'POST conversations: conversations.open', method: 'post', path: '/api/e2e/conversations', spy: (store) => jest.spyOn(store.conversations, 'open') },
    { label: 'POST conversations: messages.insert', method: 'post', path: '/api/e2e/conversations?messages=1', spy: (store) => jest.spyOn(store.messages, 'insert') },
    { label: 'DELETE conversations: conversations.removeByUser', method: 'delete', path: '/api/e2e/conversations', spy: (store) => jest.spyOn(store.conversations, 'removeByUser') },
  ])('$label Throws: 500', async ({ method, path, spy }: FailCase) => {
    const failing = spy(mongo.store).mockRejectedValue(FAILURE);

    const call = method === 'post' ? request(app).post(path) : request(app).delete(path);
    const response = await call.set('Authorization', bearer(ME));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(failing).toHaveBeenCalledTimes(1);
  });
});

// Interfaces POST /api/e2e/partner/conversations/:id/messages, /proposal and /proposal/decline
describe('Mocked: POST /api/e2e/partner/conversations/:id/messages, /proposal and /proposal/decline', () => {
  // Mocked behavior: conversations.findById rejects with Error('MongoDB is unreachable')
  // Input: the partner route named in each row, on ME's seeded conversation
  // Expected status code: 500
  // Expected behavior: the error is handled, conversations.findById is called once and nothing is saved
  // Expected output: { error: 'Internal Server Error' }
  test.each([
    { route: 'messages', body: { text: 'hi' } },
    { route: 'proposal', body: { price: 25 } },
    { route: 'proposal/decline', body: {} },
  ])('$route: conversations.findById Throws: 500', async ({ route, body }: { route: string; body: object }) => {
    const seeded = await request(app).post('/api/e2e/conversations').set('Authorization', bearer(ME));
    const failing = jest.spyOn(mongo.store.conversations, 'findById').mockRejectedValue(FAILURE);

    const response = await request(app)
      .post(`/api/e2e/partner/conversations/${String(seeded.body.conversationId)}/${route}`)
      .set('Authorization', bearer(ME))
      .send(body);

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(failing).toHaveBeenCalledTimes(1);
    expect(await mongo.db.collection('messages').countDocuments()).toBe(0);
  });
});
