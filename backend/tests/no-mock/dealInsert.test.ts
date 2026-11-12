import type { Server } from 'node:http';

import request from 'supertest';

import { ME, OTHER, bearer, clearDealData, makeDeal, makePendingProposal } from '../helpers/dealFixtures';
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
});

// Interface deals.insert
describe('Unmocked: deals.insert', () => {
  // Input: POST /api/conversations/:id/proposal/accept as ME, when the open listing already has a deal
  // Expected status code: 409
  // Expected behavior: no second deal is saved, the posts stay open and the proposal stays pending
  // Expected output: { error: 'This post is no longer available' }
  test('Post Already Has A Deal: 409', async () => {
    const conversation = await makePendingProposal(mongo.store);
    await makeDeal(mongo.store, { sellerId: ME, buyerId: 'user-third' }, { listingId: String(conversation.listingId) });

    const response = await request(app)
      .post(`/api/conversations/${conversation.id}/proposal/accept`)
      .set('Authorization', bearer(ME));

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual({ error: 'This post is no longer available' });
    expect(await countIn(mongo.db, 'deals')).toBe(1);
    expect((await mongo.store.conversations.findById(conversation.id))?.proposal?.status).toBe('pending');
    expect((await mongo.store.listings.findById(String(conversation.listingId)))?.status).toBe('open');
    expect((await mongo.store.requests.findById(String(conversation.requestId)))?.status).toBe('open');
  });

  // Input: POST /api/conversations/:id/proposal/accept as ME, answering OTHER's pending $45 proposal
  // Expected status code: 201
  // Expected behavior: the deal is saved at $45, both posts are closed and the proposal is accepted
  // Expected output: { deal, proposal } with the deal's posts and parties
  test('Deal Saved: 201', async () => {
    const conversation = await makePendingProposal(mongo.store);

    const response = await request(app)
      .post(`/api/conversations/${conversation.id}/proposal/accept`)
      .set('Authorization', bearer(ME));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      deal: { listingId: conversation.listingId, requestId: conversation.requestId, sellerId: ME, buyerId: OTHER, agreedPrice: 45 },
      proposal: { status: 'accepted' },
    });
    expect(await countIn(mongo.db, 'deals')).toBe(1);
    expect((await mongo.store.listings.findById(String(conversation.listingId)))?.status).toBe('closed');
    expect((await mongo.store.requests.findById(String(conversation.requestId)))?.status).toBe('closed');
  });
});
