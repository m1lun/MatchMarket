import type { Server } from 'node:http';

import request from 'supertest';

import type { Conversation } from '../../src/models/conversation';
import { ME, OTHER, bearer, clearDealData, makeListing, makeRequest } from '../helpers/dealFixtures';
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

interface FailureCase { label: string; error: Error & { code?: number }; status: number; body: { error: string } }

// MongoDB's code for a second deal on a post that already has one.
const DUPLICATE_KEY = 11000;

// ME's listing and OTHER's request, in a conversation where OTHER proposed $45 for ME to answer.
async function pendingProposal(): Promise<Conversation> {
  const now = new Date();
  const listing = await makeListing(mongo.store, ME);
  const buyerRequest = await makeRequest(mongo.store, OTHER);
  const { conversation } = await mongo.store.conversations.open({
    listingId: listing.id,
    requestId: buyerRequest.id,
    sellerId: ME,
    buyerId: OTHER,
    postKind: 'listing',
    lastMessage: null,
    createdAt: now,
    updatedAt: now,
  });
  await mongo.store.conversations.propose(conversation.id, {
    proposerId: OTHER,
    price: 45,
    note: '',
    status: 'pending',
    createdAt: now,
  });
  return conversation;
}

// Interface Deal insert(Deal deal), called by POST /api/conversations/:id/proposal/accept
describe('Mocked: deals.insert', () => {
  // Mocked behavior: deals.insert rejects with Error('MongoDB is unreachable'), or with a duplicate key error
  //   because another deal took one of the posts first (see table)
  // Input: POST /api/conversations/:id/proposal/accept as ME, who is answering OTHER's pending $45 proposal
  // Expected status code: 500 for the database failure, 409 for the duplicate
  // Expected behavior: the error is handled, insert is called once, no deal is saved, both posts stay open,
  //   and the proposal stays pending
  // Expected output: { error: 'Internal Server Error' }, or { error: 'This post is no longer available' }
  test.each<FailureCase>([
    {
      label: 'Database Failure',
      error: new Error('MongoDB is unreachable'),
      status: 500,
      body: { error: 'Internal Server Error' },
    },
    {
      label: 'Post Already Has A Deal',
      error: Object.assign(new Error('E11000 duplicate key error'), { code: DUPLICATE_KEY }),
      status: 409,
      body: { error: 'This post is no longer available' },
    },
  ])('$label: $status', async ({ error, status, body }: FailureCase) => {
    const conversation = await pendingProposal();
    const spy = jest.spyOn(mongo.store.deals, 'insert').mockRejectedValue(error);

    const response = await request(app)
      .post(`/api/conversations/${conversation.id}/proposal/accept`)
      .set('Authorization', bearer(ME));

    expect(response.status).toBe(status);
    expect(response.body).toStrictEqual(body);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await countIn(mongo.db, 'deals')).toBe(0);
    const stored = await mongo.store.conversations.findById(conversation.id);
    expect(stored?.proposal?.status).toBe('pending');
    const [listing, buyerRequest] = await Promise.all([
      mongo.store.listings.findById(String(conversation.listingId)),
      mongo.store.requests.findById(String(conversation.requestId)),
    ]);
    expect(listing?.status).toBe('open');
    expect(buyerRequest?.status).toBe('open');
  });
});
