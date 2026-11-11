import type { Server } from 'node:http';

import { MAX_MESSAGE_LENGTH } from '../../src/models/conversation';
import {
  BODY_ERROR,
  BODY_LIMIT,
  TOKEN_CASES,
  UNKNOWN_ID,
  UNKNOWN_IDS,
  clearConversationData,
  get,
  makeConversation,
  makeListingConversation,
  makeMessage,
  paddedBody,
  post,
  postRaw,
  storedConversations,
  storedData,
  storedMessages,
  type IdCase,
  type TokenCase,
} from '../helpers/conversationFixtures';
import { ME, OTHER, STRANGER, makeListing, makeRequest } from '../helpers/dealFixtures';
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
});

const POST_ID_ERROR = 'postId must be the id of a listing or request';
const POST_KIND_ERROR = 'postKind must be one of: listing, request';
const TEXT_ERROR = 'text must be 1 to 1000 characters';

interface BodyCase { label: string; raw: string; type?: string; details: string[] }

// Interface POST /api/conversations
describe('Unmocked: POST /api/conversations', () => {
  // Input: { postId, postKind: 'listing' } for OTHER's open listing, from ME
  // Expected status code: 201
  // Expected behavior: a conversation between ME and OTHER about the listing is stored, with no messages
  // Expected output: the conversation { id, listingId, requestId: null, sellerId: OTHER, buyerId: ME, postKind, lastMessage: null, createdAt, updatedAt }
  test('Listing: 201', async () => {
    const listing = await makeListing(mongo.store, OTHER);

    const response = await post(app, '/api/conversations', { postId: listing.id, postKind: 'listing' });

    expect(response.status).toBe(201);
    const expected = { listingId: listing.id, requestId: null, sellerId: OTHER, buyerId: ME, postKind: 'listing', lastMessage: null };
    expect(response.body).toMatchObject(expected);
    expect(await mongo.store.conversations.findById(String(response.body.id))).toMatchObject(expected);
  });

  // Input: { postId, postKind: 'request' } for OTHER's open request, from ME
  // Expected status code: 201
  // Expected behavior: a conversation about the request is stored
  // Expected output: the conversation with requestId set, listingId null, OTHER as buyer and ME as seller
  test('Request: 201', async () => {
    const buyerRequest = await makeRequest(mongo.store, OTHER);

    const response = await post(app, '/api/conversations', { postId: buyerRequest.id, postKind: 'request' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ listingId: null, requestId: buyerRequest.id, sellerId: ME, buyerId: OTHER, postKind: 'request' });
  });

  // Input: { postId, postKind: 'listing' } for a listing ME already has a conversation about
  // Expected status code: 200
  // Expected behavior: no second conversation is stored
  // Expected output: the existing conversation, with its id
  test('Already Open: 200', async () => {
    const existing = await makeListingConversation(mongo.store);

    const response = await post(app, '/api/conversations', { postId: existing.listingId, postKind: 'listing' });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(existing.id);
    expect(await storedConversations(mongo.db)).toHaveLength(1);
  });

  // Input: { postId, postKind: 'listing' } for the same listing from ME and from STRANGER
  // Expected status code: 201 for both
  // Expected behavior: each starter gets a conversation of their own with the owner
  // Expected output: two different conversation ids
  test('Different Starters Get Separate Conversations', async () => {
    const listing = await makeListing(mongo.store, OTHER);
    const body = { postId: listing.id, postKind: 'listing' };

    const mine = await post(app, '/api/conversations', body);
    const theirs = await post(app, '/api/conversations', body, { userId: STRANGER });

    expect([mine.status, theirs.status]).toStrictEqual([201, 201]);
    expect(mine.body.id).not.toBe(theirs.body.id);
  });

  // Input: { postId, postKind: 'listing', myPostId } for OTHER's listing, recommended for ME's open request
  // Expected status code: 201
  // Expected behavior: the conversation is stored with both the listing and ME's request
  // Expected output: the conversation { listingId, requestId: ME's request, sellerId: OTHER, buyerId: ME }
  test('From A Recommendation: 201', async () => {
    const listing = await makeListing(mongo.store, OTHER);
    const myRequest = await makeRequest(mongo.store, ME);

    const response = await post(app, '/api/conversations', { postId: listing.id, postKind: 'listing', myPostId: myRequest.id });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ listingId: listing.id, requestId: myRequest.id, sellerId: OTHER, buyerId: ME });
  });

  // Input: { postId, postKind: 'listing', myPostId } for a listing ME already has a conversation about, with a request it didn't have
  // Expected status code: 200
  // Expected behavior: nothing changes; the conversation keeps the posts it was opened with
  // Expected output: the existing conversation, still with requestId null
  test('Already Open Keeps Its First Posts: 200', async () => {
    const existing = await makeListingConversation(mongo.store);
    const myRequest = await makeRequest(mongo.store, ME);

    const response = await post(app, '/api/conversations', { postId: existing.listingId, postKind: 'listing', myPostId: myRequest.id });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: existing.id, requestId: null });
    expect(await storedConversations(mongo.db)).toHaveLength(1);
  });

  // Input: OTHER opened a conversation about ME's request, linked to OTHER's listing; ME then taps that listing
  // Expected status code: 200
  // Expected behavior: no second conversation between the same two people about the same listing is stored
  // Expected output: OTHER's conversation
  test('Same Pair From The Other Side: 200', async () => {
    const listing = await makeListing(mongo.store, OTHER);
    const myRequest = await makeRequest(mongo.store, ME);
    const theirs = await makeConversation(mongo.store, { listingId: listing.id, requestId: myRequest.id, sellerId: OTHER, buyerId: ME, postKind: 'request' });

    const response = await post(app, '/api/conversations', { postId: listing.id, postKind: 'listing' });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(theirs.id);
    expect(await storedConversations(mongo.db)).toHaveLength(1);
  });

  // Input: { postId, postKind: 'listing', myPostId } where myPostId is unknown, someone else's request, or closed
  // Expected status code: 404, 403 or 409
  // Expected behavior: database is unchanged
  // Expected output: { error } naming the problem
  test.each([
    { label: 'My Post Unknown', owner: null, closed: false, status: 404, error: 'Not Found' },
    { label: 'My Post Not Mine', owner: STRANGER, closed: false, status: 403, error: 'Forbidden' },
    { label: 'My Post Closed', owner: ME, closed: true, status: 409, error: 'This post is closed' },
  ])('$label: $status', async ({ owner, closed, status, error }: { label: string; owner: string | null; closed: boolean; status: number; error: string }) => {
    const listing = await makeListing(mongo.store, OTHER);
    const myPostId = owner === null ? UNKNOWN_ID : (await makeRequest(mongo.store, owner, closed ? { status: 'closed' } : {})).id;

    const response = await post(app, '/api/conversations', { postId: listing.id, postKind: 'listing', myPostId });

    expect(response.status).toBe(status);
    expect(response.body).toStrictEqual({ error });
    expect(await storedData(mongo.db)).toStrictEqual({ conversations: [], messages: [] });
  });

  // Input: a valid body with no Authorization header, or with a token that is not a valid JWT
  // Expected status code: 401
  // Expected behavior: database is unchanged
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ auth, error }: TokenCase) => {
    const listing = await makeListing(mongo.store, OTHER);

    const response = await post(app, '/api/conversations', { postId: listing.id, postKind: 'listing' }, { auth });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
    expect(await storedData(mongo.db)).toStrictEqual({ conversations: [], messages: [] });
  });

  // Input: a body that is not an object, misses or misspells fields, or has a bad postId, postKind or myPostId (see table)
  // Expected status code: 400
  // Expected behavior: database is unchanged
  // Expected output: { error: 'Invalid request', details } listing every problem
  test.each<BodyCase>([
    { label: 'Body Is An Array', raw: '[]', details: [BODY_ERROR, POST_ID_ERROR, POST_KIND_ERROR] },
    { label: 'Body Is Plain Text', raw: 'postId=1', type: 'text/plain', details: [BODY_ERROR, POST_ID_ERROR, POST_KIND_ERROR] },
    { label: 'Empty Body', raw: '{}', details: [POST_ID_ERROR, POST_KIND_ERROR] },
    { label: 'Unsupported Field', raw: `{"postId":"${UNKNOWN_ID}","postKind":"listing","ownerId":"x"}`, details: ['unsupported field "ownerId"'] },
    { label: 'Post Id Not An ObjectId', raw: '{"postId":"nope","postKind":"listing"}', details: [POST_ID_ERROR] },
    { label: 'Post Id Operator', raw: '{"postId":{"$ne":null},"postKind":"listing"}', details: [POST_ID_ERROR] },
    { label: 'Unknown Post Kind', raw: `{"postId":"${UNKNOWN_ID}","postKind":"deal"}`, details: [POST_KIND_ERROR] },
    { label: 'My Post Id Not An ObjectId', raw: `{"postId":"${UNKNOWN_ID}","postKind":"listing","myPostId":5}`, details: ['myPostId must be the id of one of your posts'] },
  ])('$label: 400', async ({ raw, type, details }: BodyCase) => {
    const response = await postRaw(app, '/api/conversations', raw, type === undefined ? {} : { type });

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Invalid request', details });
    expect(await storedData(mongo.db)).toStrictEqual({ conversations: [], messages: [] });
  });

  // Input: { postId, postKind: 'listing' } for ME's own listing
  // Expected status code: 400
  // Expected behavior: database is unchanged
  // Expected output: { error: 'Invalid request', details: ['you cannot start a conversation about your own post'] }
  test('Own Post: 400', async () => {
    const listing = await makeListing(mongo.store, ME);

    const response = await post(app, '/api/conversations', { postId: listing.id, postKind: 'listing' });

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Invalid request', details: ['you cannot start a conversation about your own post'] });
    expect(await storedData(mongo.db)).toStrictEqual({ conversations: [], messages: [] });
  });

  // Input: { postId, postKind } for an id with no post, or a listing's id sent as a request
  // Expected status code: 404
  // Expected behavior: database is unchanged
  // Expected output: { error: 'Not Found' }
  test.each([
    { label: 'Unknown Post', kind: 'listing', useListingId: false },
    { label: 'Wrong Post Kind', kind: 'request', useListingId: true },
  ])('$label: 404', async ({ kind, useListingId }: { label: string; kind: string; useListingId: boolean }) => {
    const listing = await makeListing(mongo.store, OTHER);

    const response = await post(app, '/api/conversations', { postId: useListingId ? listing.id : UNKNOWN_ID, postKind: kind });

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
    expect(await storedData(mongo.db)).toStrictEqual({ conversations: [], messages: [] });
  });

  // Input: { postId, postKind: 'listing' } for OTHER's closed listing
  // Expected status code: 409
  // Expected behavior: database is unchanged
  // Expected output: { error: 'This post is closed' }
  test('Closed Post: 409', async () => {
    const listing = await makeListing(mongo.store, OTHER, { status: 'closed' });

    const response = await post(app, '/api/conversations', { postId: listing.id, postKind: 'listing' });

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual({ error: 'This post is closed' });
    expect(await storedData(mongo.db)).toStrictEqual({ conversations: [], messages: [] });
  });
});

// Interface GET /api/conversations
describe('Unmocked: GET /api/conversations', () => {
  // Input: ME has no conversations
  // Expected status code: 200
  // Expected behavior: nothing changes
  // Expected output: { conversations: [] }
  test('No Conversations: 200', async () => {
    const response = await get(app, '/api/conversations');

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ conversations: [] });
  });

  // Input: ME started a conversation about OTHER's listing; STRANGER started one about ME's request, which has a newer message
  // Expected status code: 200
  // Expected behavior: nothing changes
  // Expected output: both conversations, newest activity first, each with its post, the other user and the last message
  test('Newest Activity First: 200', async () => {
    await mongo.store.users.upsertFromSignIn({ id: STRANGER, firstName: 'Sam', lastName: 'Lee', email: 's@example.com', pictureUrl: null });
    const listing = await makeListing(mongo.store, OTHER);
    const buyerRequest = await makeRequest(mongo.store, ME);
    const aboutListing = await makeConversation(mongo.store, { listingId: listing.id, sellerId: OTHER, buyerId: ME, postKind: 'listing' });
    const aboutRequest = await makeConversation(mongo.store, { requestId: buyerRequest.id, sellerId: STRANGER, buyerId: ME, postKind: 'request' });
    await makeMessage(mongo.store, aboutListing.id, ME, 'Is it still available?');
    await makeMessage(mongo.store, aboutRequest.id, STRANGER, 'I have one');

    const response = await get(app, '/api/conversations');

    expect(response.status).toBe(200);
    expect(response.body.conversations).toMatchObject([
      {
        id: aboutRequest.id,
        postKind: 'request',
        listing: null,
        request: { id: buyerRequest.id, name: 'Chair', status: 'open', photoId: null },
        otherUser: { id: STRANGER, firstName: 'Sam', lastName: 'Lee', pictureUrl: null },
        lastMessage: { senderId: STRANGER, text: 'I have one' },
      },
      {
        id: aboutListing.id,
        postKind: 'listing',
        listing: { id: listing.id, name: 'Chair', status: 'open', photoId: listing.photoIds[0] },
        request: null,
        otherUser: { id: OTHER, firstName: '', lastName: '', pictureUrl: null },
        lastMessage: { senderId: ME, text: 'Is it still available?' },
      },
    ]);
  });

  // Input: ME's conversation is about a listing that has since been deleted
  // Expected status code: 200
  // Expected behavior: nothing changes
  // Expected output: the conversation with listing: null
  test('Deleted Post: 200', async () => {
    const conversation = await makeListingConversation(mongo.store);
    await mongo.store.listings.remove(String(conversation.listingId));

    const response = await get(app, '/api/conversations');

    expect(response.status).toBe(200);
    expect(response.body.conversations).toMatchObject([{ id: conversation.id, listing: null }]);
  });

  // Input: OTHER and STRANGER have a conversation that ME is not in
  // Expected status code: 200
  // Expected behavior: nothing changes
  // Expected output: { conversations: [] }
  test('Other Users Conversations Are Hidden: 200', async () => {
    const listing = await makeListing(mongo.store, OTHER);
    await makeConversation(mongo.store, { listingId: listing.id, sellerId: OTHER, buyerId: STRANGER, postKind: 'listing' });

    const response = await get(app, '/api/conversations');

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ conversations: [] });
  });

  // Input: no Authorization header, or a token that is not a valid JWT
  // Expected status code: 401
  // Expected behavior: nothing changes
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ auth, error }: TokenCase) => {
    const response = await get(app, '/api/conversations', { auth });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
  });
});

// Interface GET /api/conversations/:id/messages
describe('Unmocked: GET /api/conversations/:id/messages', () => {
  // Input: limit=2 on a conversation with 3 messages, then before=<nextCursor>
  // Expected status code: 200
  // Expected behavior: nothing changes
  // Expected output: the 2 newest messages and a nextCursor, then the oldest message and nextCursor: null
  test('Pages Newest First: 200', async () => {
    const conversation = await makeListingConversation(mongo.store);
    for (const text of ['one', 'two', 'three']) {
      await makeMessage(mongo.store, conversation.id, ME, text);
    }
    const url = `/api/conversations/${conversation.id}/messages`;

    const first = await get(app, `${url}?limit=2`);
    const second = await get(app, `${url}?limit=2&before=${String(first.body.nextCursor)}`, { userId: OTHER });

    expect(first.status).toBe(200);
    expect(first.body.messages.map((m: { text: string }) => m.text)).toStrictEqual(['three', 'two']);
    expect(first.body.nextCursor).toBe(first.body.messages[1].id);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ messages: [{ text: 'one', senderId: ME, conversationId: conversation.id }], nextCursor: null });
  });

  // Input: no query on a conversation with no messages
  // Expected status code: 200
  // Expected behavior: nothing changes
  // Expected output: { messages: [], nextCursor: null }
  test('No Messages: 200', async () => {
    const conversation = await makeListingConversation(mongo.store);

    const response = await get(app, `/api/conversations/${conversation.id}/messages`);

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ messages: [], nextCursor: null });
  });

  // Input: a limit out of range or not a number, a before that is not a message id, or an unknown parameter
  // Expected status code: 400
  // Expected behavior: nothing changes
  // Expected output: { error: 'Invalid request', details } naming the bad parameter
  test.each([
    { label: 'Limit 0', query: 'limit=0', details: ['limit must be a whole number from 1 to 50'] },
    { label: 'Limit 51', query: 'limit=51', details: ['limit must be a whole number from 1 to 50'] },
    { label: 'Limit Not A Number', query: 'limit=ten', details: ['limit must be a whole number from 1 to 50'] },
    { label: 'Before Not An Id', query: 'before=nope', details: ['before must be the nextCursor from a previous page'] },
    { label: 'Before Repeated', query: `before=${UNKNOWN_ID}&before=${UNKNOWN_ID}`, details: ['before must be the nextCursor from a previous page'] },
    { label: 'Unknown Parameter', query: 'page=2', details: ['unsupported parameter "page"'] },
  ])('$label: 400', async ({ query, details }: { label: string; query: string; details: string[] }) => {
    const conversation = await makeListingConversation(mongo.store);

    const response = await get(app, `/api/conversations/${conversation.id}/messages?${query}`);

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Invalid request', details });
  });

  // Input: a request from STRANGER, who is not in the conversation
  // Expected status code: 403
  // Expected behavior: nothing changes
  // Expected output: { error: 'Forbidden' }
  test('Not A Participant: 403', async () => {
    const conversation = await makeListingConversation(mongo.store);
    await makeMessage(mongo.store, conversation.id, ME, 'private');

    const response = await get(app, `/api/conversations/${conversation.id}/messages`, { userId: STRANGER });

    expect(response.status).toBe(403);
    expect(response.body).toStrictEqual({ error: 'Forbidden' });
  });

  // Input: an id with no conversation, or an id that is not a valid ObjectId
  // Expected status code: 404
  // Expected behavior: nothing changes
  // Expected output: { error: 'Not Found' }
  test.each(UNKNOWN_IDS)('$label: 404', async ({ id }: IdCase) => {
    const response = await get(app, `/api/conversations/${id}/messages`);

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
  });

  // Input: no Authorization header, or a token that is not a valid JWT
  // Expected status code: 401
  // Expected behavior: nothing changes
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ auth, error }: TokenCase) => {
    const conversation = await makeListingConversation(mongo.store);

    const response = await get(app, `/api/conversations/${conversation.id}/messages`, { auth });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
  });
});

// Interface POST /api/conversations/:id/messages
describe('Unmocked: POST /api/conversations/:id/messages', () => {
  // Input: { text } from ME and then from OTHER, the two participants; one text has surrounding spaces, one is 1000 characters
  // Expected status code: 201
  // Expected behavior: the message is stored trimmed and becomes the conversation's lastMessage
  // Expected output: the message { id, conversationId, senderId, text, createdAt }
  test.each([
    { label: 'Starter Sends, Trimmed', userId: ME, text: '  Is it still available?  ', stored: 'Is it still available?' },
    { label: 'Owner Sends, 1000 Characters', userId: OTHER, text: 'x'.repeat(MAX_MESSAGE_LENGTH), stored: 'x'.repeat(MAX_MESSAGE_LENGTH) },
  ])('$label: 201', async ({ userId, text, stored }: { label: string; userId: string; text: string; stored: string }) => {
    const conversation = await makeListingConversation(mongo.store);

    const response = await post(app, `/api/conversations/${conversation.id}/messages`, { text }, { userId });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ conversationId: conversation.id, senderId: userId, text: stored });
    expect(await storedMessages(mongo.db)).toMatchObject([{ senderId: userId, text: stored }]);
    const updated = await mongo.store.conversations.findById(conversation.id);
    expect(updated?.lastMessage).toMatchObject({ senderId: userId, text: stored });
    expect(updated?.updatedAt).toStrictEqual(updated?.lastMessage?.createdAt);
  });

  // Input: a body that is not an object, has an unsupported field, or a text that is missing, blank, not text or over 1000 characters
  // Expected status code: 400
  // Expected behavior: database is unchanged
  // Expected output: { error: 'Invalid request', details } listing every problem
  test.each<BodyCase>([
    { label: 'Body Is An Array', raw: '["hi"]', details: [BODY_ERROR, TEXT_ERROR] },
    { label: 'Text Missing', raw: '{}', details: [TEXT_ERROR] },
    { label: 'Text Blank', raw: '{"text":"   "}', details: [TEXT_ERROR] },
    { label: 'Text Not A String', raw: '{"text":5}', details: [TEXT_ERROR] },
    { label: 'Text Over 1000 Characters', raw: JSON.stringify({ text: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }), details: [TEXT_ERROR] },
    { label: 'Unsupported Field', raw: '{"text":"hi","senderId":"x"}', details: ['unsupported field "senderId"'] },
  ])('$label: 400', async ({ raw, details }: BodyCase) => {
    const conversation = await makeListingConversation(mongo.store);
    const before = await storedData(mongo.db);

    const response = await postRaw(app, `/api/conversations/${conversation.id}/messages`, raw);

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Invalid request', details });
    expect(await storedData(mongo.db)).toStrictEqual(before);
  });

  // Input: malformed JSON
  // Expected status code: 400
  // Expected behavior: database is unchanged
  // Expected output: { error: 'Malformed request body' }
  test('Malformed JSON: 400', async () => {
    const conversation = await makeListingConversation(mongo.store);
    const before = await storedData(mongo.db);

    const response = await postRaw(app, `/api/conversations/${conversation.id}/messages`, '{"text":');

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Malformed request body' });
    expect(await storedData(mongo.db)).toStrictEqual(before);
  });

  // Input: { text: 'hi' } padded with spaces to one byte over 16 KB
  // Expected status code: 413
  // Expected behavior: database is unchanged
  // Expected output: { error: 'Request body too large' }
  test('Body Over 16 KB: 413', async () => {
    const conversation = await makeListingConversation(mongo.store);
    const before = await storedData(mongo.db);

    const response = await postRaw(app, `/api/conversations/${conversation.id}/messages`, paddedBody({ text: 'hi' }, BODY_LIMIT + 1));

    expect(response.status).toBe(413);
    expect(response.body).toStrictEqual({ error: 'Request body too large' });
    expect(await storedData(mongo.db)).toStrictEqual(before);
  });

  // Input: { text: 'hi' } from STRANGER, who is not in the conversation
  // Expected status code: 403
  // Expected behavior: database is unchanged
  // Expected output: { error: 'Forbidden' }
  test('Not A Participant: 403', async () => {
    const conversation = await makeListingConversation(mongo.store);
    const before = await storedData(mongo.db);

    const response = await post(app, `/api/conversations/${conversation.id}/messages`, { text: 'hi' }, { userId: STRANGER });

    expect(response.status).toBe(403);
    expect(response.body).toStrictEqual({ error: 'Forbidden' });
    expect(await storedData(mongo.db)).toStrictEqual(before);
  });

  // Input: { text: 'hi' } on an id with no conversation, or an id that is not a valid ObjectId
  // Expected status code: 404
  // Expected behavior: database is unchanged
  // Expected output: { error: 'Not Found' }
  test.each(UNKNOWN_IDS)('$label: 404', async ({ id }: IdCase) => {
    const response = await post(app, `/api/conversations/${id}/messages`, { text: 'hi' });

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
    expect(await storedData(mongo.db)).toStrictEqual({ conversations: [], messages: [] });
  });

  // Input: { text: 'hi' } with no Authorization header, or with a token that is not a valid JWT
  // Expected status code: 401
  // Expected behavior: database is unchanged
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ auth, error }: TokenCase) => {
    const conversation = await makeListingConversation(mongo.store);
    const before = await storedData(mongo.db);

    const response = await post(app, `/api/conversations/${conversation.id}/messages`, { text: 'hi' }, { auth });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
    expect(await storedData(mongo.db)).toStrictEqual(before);
  });
});
