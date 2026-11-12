import type { Server } from 'node:http';

import request from 'supertest';

import { ME, bearer, clearDealData, makePendingProposal } from '../helpers/dealFixtures';
import { countIn } from '../helpers/postFixtures';
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
  await Promise.all([clearDealData(mongo.db), mongo.db.collection('conversations').deleteMany({})]);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Interface deals.insert
describe('Mocked: deals.insert', () => {
  // Mocked behavior: deals.insert rejects with Error('MongoDB is unreachable')
  // Input: POST /api/conversations/:id/proposal/accept as ME, answering OTHER's pending proposal
  // Expected status code: 500
  // Expected behavior: insert is called once, no deal is saved, the posts stay open and the proposal stays pending
  // Expected output: { error: 'Internal Server Error' }
  test('deals.insert Throws: 500', async () => {
    const conversation = await makePendingProposal(mongo.store);
    const spy = jest.spyOn(mongo.store.deals, 'insert').mockRejectedValue(new Error('MongoDB is unreachable'));

    const response = await request(app)
      .post(`/api/conversations/${conversation.id}/proposal/accept`)
      .set('Authorization', bearer(ME));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual({ error: 'Internal Server Error' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await countIn(mongo.db, 'deals')).toBe(0);
    expect((await mongo.store.conversations.findById(conversation.id))?.proposal?.status).toBe('pending');
    expect((await mongo.store.listings.findById(String(conversation.listingId)))?.status).toBe('open');
    expect((await mongo.store.requests.findById(String(conversation.requestId)))?.status).toBe('open');
  });
});
