import type { Server } from 'node:http';

import type { Conversation } from '../../src/models/conversation';
import {
  clearConversationData,
  makeConversation,
  makeListingConversation,
  makeProposal,
  post,
  storedConversations,
} from '../helpers/conversationFixtures';
import { ME, OTHER, makeListing, makeRequest } from '../helpers/dealFixtures';
import { expectServerError, rejecting, type FailureCase } from '../helpers/storeFailures';
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
  await clearConversationData(mongo.db);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

interface DealSetup {
  conversation: Conversation;
  listingId: string;
  requestId: string;
}

// OTHER's listing and ME's request, linked in a conversation, with ME's pending proposal.
async function pendingDeal(): Promise<DealSetup> {
  const listing = await makeListing(mongo.store, OTHER);
  const myRequest = await makeRequest(mongo.store, ME);
  const conversation = await makeConversation(mongo.store, {
    listingId: listing.id,
    requestId: myRequest.id,
    sellerId: OTHER,
    buyerId: ME,
    postKind: 'listing',
  });
  await makeProposal(mongo.store, conversation.id, ME);
  return { conversation, listingId: listing.id, requestId: myRequest.id };
}

function accept(conversationId: string): ReturnType<typeof post> {
  return post(app, `/api/conversations/${conversationId}/proposal/accept`, {}, { userId: OTHER });
}

// Interface POST /api/conversations/:id/proposal
describe('Mocked: POST /api/conversations/:id/proposal', () => {
  // Mocked behavior: the store method named in each row rejects with Error('MongoDB is unreachable')
  // Input: { price: 35 } from ME in a conversation with no proposal
  // Expected status code: 500
  // Expected behavior: the error is handled, the method is called once and no proposal is stored
  // Expected output: { error: 'Internal Server Error' }
  test.each<FailureCase>([
    { label: 'conversations.findById', fail: (store) => rejecting(store.conversations, 'findById') },
    { label: 'conversations.propose', fail: (store) => rejecting(store.conversations, 'propose') },
  ])('$label Throws: 500', async ({ fail }: FailureCase) => {
    const conversation = await makeListingConversation(mongo.store);
    const before = await storedConversations(mongo.db);
    const spy = fail(mongo.store);

    const response = await post(app, `/api/conversations/${conversation.id}/proposal`, { price: 35 });

    expectServerError(response, spy);
    jest.restoreAllMocks();
    expect(await storedConversations(mongo.db)).toStrictEqual(before);
  });
});

// Interface POST /api/conversations/:id/proposal/accept
describe('Mocked: POST /api/conversations/:id/proposal/accept', () => {
  // Mocked behavior: the store method named in each row rejects with Error('MongoDB is unreachable'), once
  // Input: OTHER accepts ME's pending proposal in a conversation about OTHER's listing and ME's request, then accepts again
  // Expected status code: 500, then 201 for the retry
  // Expected behavior: the error is handled and the method is called once; the retry finishes the deal, whether or not
  //   the failed accept already stored it, so there is exactly one deal, both posts are closed and the proposal is accepted
  // Expected output: { error: 'Internal Server Error' }, then { deal, proposal } for the retry
  test.each<FailureCase>([
    { label: 'conversations.findById', fail: (store) => rejecting(store.conversations, 'findById') },
    { label: 'listings.findById', fail: (store) => rejecting(store.listings, 'findById') },
    { label: 'requests.findById', fail: (store) => rejecting(store.requests, 'findById') },
    { label: 'deals.findByPosts', fail: (store) => rejecting(store.deals, 'findByPosts') },
    { label: 'deals.insert', fail: (store) => rejecting(store.deals, 'insert') },
    { label: 'listings.replace', fail: (store) => rejecting(store.listings, 'replace') },
    { label: 'requests.replace', fail: (store) => rejecting(store.requests, 'replace') },
    { label: 'conversations.setProposalStatus', fail: (store) => rejecting(store.conversations, 'setProposalStatus') },
  ])('$label Throws, Then Retry: 500, 201', async ({ fail }: FailureCase) => {
    const { conversation, listingId, requestId } = await pendingDeal();
    const spy = fail(mongo.store);

    const response = await accept(conversation.id);

    expectServerError(response, spy);
    jest.restoreAllMocks();
    const retry = await accept(conversation.id);
    expect(retry.status).toBe(201);
    expect(await mongo.db.collection('deals').countDocuments()).toBe(1);
    const [listing, request] = await Promise.all([mongo.store.listings.findById(listingId), mongo.store.requests.findById(requestId)]);
    expect([listing?.status, request?.status]).toStrictEqual(['closed', 'closed']);
    expect((await mongo.store.conversations.findById(conversation.id))?.proposal?.status).toBe('accepted');
  });

  // Mocked behavior: deals.insert rejects with MongoDB's duplicate-key error, as when another accept on the same post
  //   records its deal between this accept's checks and its insert
  // Input: OTHER accepts ME's pending proposal
  // Expected status code: 409
  // Expected behavior: no deal is stored, the posts stay open and the proposal stays pending
  // Expected output: { error: 'This post is no longer available' }
  test('Deal Recorded Concurrently: 409', async () => {
    const { conversation } = await pendingDeal();
    jest.spyOn(mongo.store.deals, 'insert').mockRejectedValue(Object.assign(new Error('E11000 duplicate key error'), { code: 11000 }));

    const response = await accept(conversation.id);

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual({ error: 'This post is no longer available' });
    expect(mongo.store.deals.insert).toHaveBeenCalledTimes(1);
    expect(await mongo.db.collection('deals').countDocuments()).toBe(0);
    expect((await mongo.store.conversations.findById(conversation.id))?.proposal?.status).toBe('pending');
  });
});

// Interface POST /api/conversations/:id/proposal/decline
describe('Mocked: POST /api/conversations/:id/proposal/decline', () => {
  // Mocked behavior: the store method named in each row rejects with Error('MongoDB is unreachable')
  // Input: OTHER declines ME's pending proposal
  // Expected status code: 500
  // Expected behavior: the error is handled, the method is called once and the proposal stays pending
  // Expected output: { error: 'Internal Server Error' }
  test.each<FailureCase>([
    { label: 'conversations.findById', fail: (store) => rejecting(store.conversations, 'findById') },
    { label: 'conversations.setProposalStatus', fail: (store) => rejecting(store.conversations, 'setProposalStatus') },
  ])('$label Throws: 500', async ({ fail }: FailureCase) => {
    const { conversation } = await pendingDeal();
    const spy = fail(mongo.store);

    const response = await post(app, `/api/conversations/${conversation.id}/proposal/decline`, {}, { userId: OTHER });

    expectServerError(response, spy);
    jest.restoreAllMocks();
    expect((await mongo.store.conversations.findById(conversation.id))?.proposal?.status).toBe('pending');
  });
});
