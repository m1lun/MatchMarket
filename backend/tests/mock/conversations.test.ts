import type { Server } from 'node:http';

import {
  clearConversationData,
  get,
  makeListingConversation,
  post,
  storedConversations,
  storedData,
  storedMessages,
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

// Interface POST /api/conversations
describe('Mocked: POST /api/conversations', () => {
  // Mocked behavior: the store method named in each row rejects with Error('MongoDB is unreachable')
  // Input: { postId, postKind: 'listing', myPostId } for OTHER's open listing and ME's open request, from ME
  // Expected status code: 500
  // Expected behavior: the error is handled, the method is called once and no conversation is stored
  // Expected output: { error: 'Internal Server Error' }
  test.each<FailureCase>([
    { label: 'listings.findById', fail: (store) => rejecting(store.listings, 'findById') },
    { label: 'requests.findById', fail: (store) => rejecting(store.requests, 'findById') },
    { label: 'conversations.open', fail: (store) => rejecting(store.conversations, 'open') },
  ])('$label Throws: 500', async ({ fail }: FailureCase) => {
    const listing = await makeListing(mongo.store, OTHER);
    const myRequest = await makeRequest(mongo.store, ME);
    const spy = fail(mongo.store);

    const response = await post(app, '/api/conversations', { postId: listing.id, postKind: 'listing', myPostId: myRequest.id });

    expectServerError(response, spy);
    jest.restoreAllMocks();
    expect(await storedData(mongo.db)).toStrictEqual({ conversations: [], messages: [] });
  });
});

// Interface GET /api/conversations
describe('Mocked: GET /api/conversations', () => {
  // Mocked behavior: the store method named in each row rejects with Error('MongoDB is unreachable')
  // Input: ME has one conversation about OTHER's listing
  // Expected status code: 500
  // Expected behavior: the error is handled and the method is called once
  // Expected output: { error: 'Internal Server Error' }
  test.each<FailureCase>([
    { label: 'conversations.listByUser', fail: (store) => rejecting(store.conversations, 'listByUser') },
    { label: 'users.findPublicByIds', fail: (store) => rejecting(store.users, 'findPublicByIds') },
    { label: 'listings.findByIds', fail: (store) => rejecting(store.listings, 'findByIds') },
  ])('$label Throws: 500', async ({ fail }: FailureCase) => {
    await makeListingConversation(mongo.store);
    const spy = fail(mongo.store);

    const response = await get(app, '/api/conversations');

    expectServerError(response, spy);
  });
});

// Interface GET /api/conversations/:id/messages
describe('Mocked: GET /api/conversations/:id/messages', () => {
  // Mocked behavior: the store method named in each row rejects with Error('MongoDB is unreachable')
  // Input: a request from ME for a conversation ME is in
  // Expected status code: 500
  // Expected behavior: the error is handled and the method is called once
  // Expected output: { error: 'Internal Server Error' }
  test.each<FailureCase>([
    { label: 'conversations.findById', fail: (store) => rejecting(store.conversations, 'findById') },
    { label: 'messages.listByConversation', fail: (store) => rejecting(store.messages, 'listByConversation') },
  ])('$label Throws: 500', async ({ fail }: FailureCase) => {
    const conversation = await makeListingConversation(mongo.store);
    const spy = fail(mongo.store);

    const response = await get(app, `/api/conversations/${conversation.id}/messages`);

    expectServerError(response, spy);
  });
});

// Interface POST /api/conversations/:id/messages
describe('Mocked: POST /api/conversations/:id/messages', () => {
  // Mocked behavior: the store method named in each row rejects with Error('MongoDB is unreachable')
  // Input: { text: 'hi' } from ME in a conversation ME is in
  // Expected status code: 500
  // Expected behavior: the error is handled and the method is called once; if conversations.recordMessage fails the message
  //   stays stored but the conversation's lastMessage is unchanged
  // Expected output: { error: 'Internal Server Error' }
  test.each<FailureCase & { messages: number }>([
    { label: 'conversations.findById', fail: (store) => rejecting(store.conversations, 'findById'), messages: 0 },
    { label: 'messages.insert', fail: (store) => rejecting(store.messages, 'insert'), messages: 0 },
    { label: 'conversations.recordMessage', fail: (store) => rejecting(store.conversations, 'recordMessage'), messages: 1 },
  ])('$label Throws: 500', async ({ fail, messages }: FailureCase & { messages: number }) => {
    const conversation = await makeListingConversation(mongo.store);
    const spy = fail(mongo.store);

    const response = await post(app, `/api/conversations/${conversation.id}/messages`, { text: 'hi' });

    expectServerError(response, spy);
    jest.restoreAllMocks();
    expect(await storedMessages(mongo.db)).toHaveLength(messages);
    expect(await storedConversations(mongo.db)).toMatchObject([{ lastMessage: null }]);
  });

  // Mocked behavior: conversations.recordMessage rejects with Error('MongoDB is unreachable') for the first message only
  // Input: { text: 'first' } from ME, then { text: 'second' } from OTHER
  // Expected status code: 500, then 201
  // Expected behavior: the first message is stored but the conversations list keeps the old last message, a known
  //   limitation without a transaction; the next message sent sets the last message again, so the list catches up
  // Expected output: { error: 'Internal Server Error' }, then the second message
  test('recordMessage Throws, Next Message Repairs The Last Message: 500, 201', async () => {
    const conversation = await makeListingConversation(mongo.store);
    const spy = jest.spyOn(mongo.store.conversations, 'recordMessage').mockRejectedValueOnce(new Error('MongoDB is unreachable'));

    const failed = await post(app, `/api/conversations/${conversation.id}/messages`, { text: 'first' });
    const next = await post(app, `/api/conversations/${conversation.id}/messages`, { text: 'second' }, { userId: OTHER });

    expect([failed.status, next.status]).toStrictEqual([500, 201]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await storedMessages(mongo.db)).toMatchObject([{ text: 'first' }, { text: 'second' }]);
    expect(await storedConversations(mongo.db)).toMatchObject([{ lastMessage: { senderId: OTHER, text: 'second' } }]);
  });
});
