import type { Server } from 'node:http';

import { ObjectId } from 'mongodb';

import { MAX_NOTE_LENGTH, type Conversation, type ProposalStatus } from '../../src/models/conversation';
import {
  BODY_ERROR,
  BODY_LIMIT,
  TOKEN_CASES,
  UNKNOWN_IDS,
  clearConversationData,
  makeConversation,
  makeListingConversation,
  makeProposal,
  paddedBody,
  post,
  postRaw,
  storedConversations,
  type IdCase,
  type TokenCase,
} from '../helpers/conversationFixtures';
import { ME, OTHER, STRANGER, makeDeal, makeListing, makeRequest } from '../helpers/dealFixtures';
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

const PRICE_ERROR = 'price must be a number of at least 0';
const NOTE_ERROR = `note must be text of at most ${MAX_NOTE_LENGTH} characters`;
const NO_PENDING = { error: 'There is no pending proposal' };
const OWN_PROPOSAL = { error: 'You cannot answer your own proposal' };
const POST_GONE = { error: 'This post is no longer available' };

interface BodyCase { label: string; raw: string; details: string[] }
interface StatusCase { label: string; status: ProposalStatus | null }

// A conversation that already had a proposal from ME, answered with `status`, or none at all for null.
const ANSWERED_CASES: StatusCase[] = [
  { label: 'No Proposal Yet', status: null },
  { label: 'Proposal Declined', status: 'declined' },
  { label: 'Proposal Accepted', status: 'accepted' },
];

interface DealSetup {
  conversation: Conversation;
  listingId: string;
  requestId: string;
}

// OTHER's listing and ME's request, linked in a conversation, with ME's pending proposal of 35.
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

async function conversationWithProposal(status: ProposalStatus | null): Promise<Conversation> {
  const conversation = await makeListingConversation(mongo.store);
  if (status !== null) {
    await makeProposal(mongo.store, conversation.id, ME);
    await mongo.store.conversations.setProposalStatus(conversation.id, status);
  }
  return conversation;
}

async function storedDeals(): Promise<unknown[]> {
  return mongo.db.collection('deals').find().toArray();
}

async function postStatuses(setup: DealSetup): Promise<(string | undefined)[]> {
  const [listing, request] = await Promise.all([
    mongo.store.listings.findById(setup.listingId),
    mongo.store.requests.findById(setup.requestId),
  ]);
  return [listing?.status, request?.status];
}

function proposalUrl(conversationId: string, action = ''): string {
  return `/api/conversations/${conversationId}/proposal${action}`;
}

// Interface POST /api/conversations/:id/proposal
describe('Unmocked: POST /api/conversations/:id/proposal', () => {
  // Input: { price: 35, note: '  Can pick up today  ' } from ME, in a conversation with no proposal yet
  // Expected status code: 201
  // Expected behavior: the proposal is stored on the conversation as pending, with the note trimmed, and becomes its latest activity
  // Expected output: the proposal { proposerId: ME, price: 35, note: 'Can pick up today', status: 'pending', createdAt }
  test('Price And Note: 201', async () => {
    const conversation = await makeListingConversation(mongo.store);

    const response = await post(app, proposalUrl(conversation.id), { price: 35, note: '  Can pick up today  ' });

    expect(response.status).toBe(201);
    const expected = { proposerId: ME, price: 35, note: 'Can pick up today', status: 'pending' };
    expect(response.body).toMatchObject(expected);
    const stored = await mongo.store.conversations.findById(conversation.id);
    expect(stored?.proposal).toMatchObject(expected);
    expect(stored?.updatedAt).toStrictEqual(stored?.proposal?.createdAt);
  });

  // Input: a price of 0 with no note from ME, or a note of exactly 300 characters from OTHER, the post's owner
  // Expected status code: 201
  // Expected behavior: the proposal is stored as pending; a missing note is stored as ''
  // Expected output: the proposal with the caller as proposerId
  test.each([
    { label: 'Price 0, No Note', userId: ME, body: { price: 0 }, note: '' },
    { label: 'Owner Proposes, 300 Character Note', userId: OTHER, body: { price: 50, note: 'x'.repeat(MAX_NOTE_LENGTH) }, note: 'x'.repeat(MAX_NOTE_LENGTH) },
  ])('$label: 201', async ({ userId, body, note }: { label: string; userId: string; body: object; note: string }) => {
    const conversation = await makeListingConversation(mongo.store);

    const response = await post(app, proposalUrl(conversation.id), body, { userId });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ proposerId: userId, note, status: 'pending' });
    expect((await mongo.store.conversations.findById(conversation.id))?.proposal).toMatchObject({ proposerId: userId, note });
  });

  // Input: { price: 40 } from OTHER, after OTHER declined ME's proposal
  // Expected status code: 201
  // Expected behavior: the new pending proposal replaces the declined one
  // Expected output: the proposal { proposerId: OTHER, price: 40, status: 'pending' }
  test('After A Decline: 201', async () => {
    const conversation = await conversationWithProposal('declined');

    const response = await post(app, proposalUrl(conversation.id), { price: 40 }, { userId: OTHER });

    expect(response.status).toBe(201);
    expect((await mongo.store.conversations.findById(conversation.id))?.proposal).toMatchObject({ proposerId: OTHER, price: 40, status: 'pending' });
  });

  // Input: { price: 40 } from OTHER while ME's proposal is pending, or after it was accepted
  // Expected status code: 409
  // Expected behavior: database is unchanged
  // Expected output: { error: 'A proposal is already pending or accepted' }
  test.each<{ label: string; status: ProposalStatus }>([
    { label: 'Proposal Pending', status: 'pending' },
    { label: 'Proposal Accepted', status: 'accepted' },
  ])('$label: 409', async ({ status }) => {
    const conversation = await conversationWithProposal(status);
    const before = await storedConversations(mongo.db);

    const response = await post(app, proposalUrl(conversation.id), { price: 40 }, { userId: OTHER });

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual({ error: 'A proposal is already pending or accepted' });
    expect(await storedConversations(mongo.db)).toStrictEqual(before);
  });

  // Input: a body that is not an object, has an unsupported field, a missing, negative or non-number price, or a bad note
  // Expected status code: 400
  // Expected behavior: database is unchanged
  // Expected output: { error: 'Invalid request', details } listing every problem
  test.each<BodyCase>([
    { label: 'Body Is An Array', raw: '[35]', details: [BODY_ERROR, PRICE_ERROR] },
    { label: 'Price Missing', raw: '{}', details: [PRICE_ERROR] },
    { label: 'Price Negative', raw: '{"price":-1}', details: [PRICE_ERROR] },
    { label: 'Price Is Text', raw: '{"price":"35"}', details: [PRICE_ERROR] },
    { label: 'Note Not Text', raw: '{"price":35,"note":5}', details: [NOTE_ERROR] },
    { label: 'Note Over 300 Characters', raw: JSON.stringify({ price: 35, note: 'x'.repeat(MAX_NOTE_LENGTH + 1) }), details: [NOTE_ERROR] },
    { label: 'Unsupported Field', raw: '{"price":35,"status":"accepted"}', details: ['unsupported field "status"'] },
  ])('$label: 400', async ({ raw, details }: BodyCase) => {
    const conversation = await makeListingConversation(mongo.store);
    const before = await storedConversations(mongo.db);

    const response = await postRaw(app, proposalUrl(conversation.id), raw);

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Invalid request', details });
    expect(await storedConversations(mongo.db)).toStrictEqual(before);
  });

  // Input: malformed JSON
  // Expected status code: 400
  // Expected behavior: database is unchanged
  // Expected output: { error: 'Malformed request body' }
  test('Malformed JSON: 400', async () => {
    const conversation = await makeListingConversation(mongo.store);
    const before = await storedConversations(mongo.db);

    const response = await postRaw(app, proposalUrl(conversation.id), '{"price":');

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Malformed request body' });
    expect(await storedConversations(mongo.db)).toStrictEqual(before);
  });

  // Input: { price: 35 } padded with spaces to one byte over 16 KB
  // Expected status code: 413
  // Expected behavior: database is unchanged
  // Expected output: { error: 'Request body too large' }
  test('Body Over 16 KB: 413', async () => {
    const conversation = await makeListingConversation(mongo.store);
    const before = await storedConversations(mongo.db);

    const response = await postRaw(app, proposalUrl(conversation.id), paddedBody({ price: 35 }, BODY_LIMIT + 1));

    expect(response.status).toBe(413);
    expect(response.body).toStrictEqual({ error: 'Request body too large' });
    expect(await storedConversations(mongo.db)).toStrictEqual(before);
  });

  // Input: { price: 35 } from STRANGER, who is not in the conversation
  // Expected status code: 403
  // Expected behavior: database is unchanged
  // Expected output: { error: 'Forbidden' }
  test('Not A Participant: 403', async () => {
    const conversation = await makeListingConversation(mongo.store);
    const before = await storedConversations(mongo.db);

    const response = await post(app, proposalUrl(conversation.id), { price: 35 }, { userId: STRANGER });

    expect(response.status).toBe(403);
    expect(response.body).toStrictEqual({ error: 'Forbidden' });
    expect(await storedConversations(mongo.db)).toStrictEqual(before);
  });

  // Input: { price: 35 } on an id with no conversation, or an id that is not a valid ObjectId
  // Expected status code: 404
  // Expected behavior: database is unchanged
  // Expected output: { error: 'Not Found' }
  test.each(UNKNOWN_IDS)('$label: 404', async ({ id }: IdCase) => {
    const response = await post(app, proposalUrl(id), { price: 35 });

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
    expect(await storedConversations(mongo.db)).toStrictEqual([]);
  });

  // Input: { price: 35 } with no Authorization header, or with a token that is not a valid JWT
  // Expected status code: 401
  // Expected behavior: database is unchanged
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ auth, error }: TokenCase) => {
    const conversation = await makeListingConversation(mongo.store);
    const before = await storedConversations(mongo.db);

    const response = await post(app, proposalUrl(conversation.id), { price: 35 }, { auth });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
    expect(await storedConversations(mongo.db)).toStrictEqual(before);
  });
});

// Interface POST /api/conversations/:id/proposal/accept
describe('Unmocked: POST /api/conversations/:id/proposal/accept', () => {
  // Input: OTHER accepts ME's pending proposal of 35, in a conversation about OTHER's listing and ME's request
  // Expected status code: 201
  // Expected behavior: a deal at 35 between OTHER (seller) and ME (buyer) is stored, both posts are closed and the proposal is accepted
  // Expected output: { deal: { id, listingId, requestId, sellerId, buyerId, agreedPrice: 35, createdAt }, proposal: { status: 'accepted', ... } }
  test('Listing And Request: 201', async () => {
    const setup = await pendingDeal();

    const response = await post(app, proposalUrl(setup.conversation.id, '/accept'), {}, { userId: OTHER });

    expect(response.status).toBe(201);
    const deal = { listingId: setup.listingId, requestId: setup.requestId, sellerId: OTHER, buyerId: ME, agreedPrice: 35 };
    expect(response.body).toMatchObject({ deal, proposal: { proposerId: ME, price: 35, status: 'accepted' } });
    expect(await storedDeals()).toMatchObject([deal]);
    expect(await postStatuses(setup)).toStrictEqual(['closed', 'closed']);
    expect((await mongo.store.conversations.findById(setup.conversation.id))?.proposal?.status).toBe('accepted');
  });

  // Input: the post's owner accepts the starter's pending proposal in a conversation about one listing, or about one request
  // Expected status code: 201
  // Expected behavior: a deal with only that post is stored and that post is closed
  // Expected output: { deal, proposal } with the other post id null
  test.each([
    { label: 'Listing Only', kind: 'listing' as const },
    { label: 'Request Only', kind: 'request' as const },
  ])('$label: 201', async ({ kind }) => {
    const theirPost = kind === 'listing' ? await makeListing(mongo.store, OTHER) : await makeRequest(mongo.store, OTHER);
    const parties = kind === 'listing' ? { sellerId: OTHER, buyerId: ME } : { sellerId: ME, buyerId: OTHER };
    const postIds = kind === 'listing' ? { listingId: theirPost.id } : { requestId: theirPost.id };
    const conversation = await makeConversation(mongo.store, { ...parties, ...postIds, postKind: kind });
    await makeProposal(mongo.store, conversation.id, ME);

    const response = await post(app, proposalUrl(conversation.id, '/accept'), {}, { userId: OTHER });

    expect(response.status).toBe(201);
    const deal = { ...parties, listingId: null, requestId: null, ...postIds };
    expect(response.body.deal).toMatchObject(deal);
    expect(await storedDeals()).toMatchObject([deal]);
    const posts = kind === 'listing' ? mongo.store.listings : mongo.store.requests;
    expect((await posts.findById(theirPost.id))?.status).toBe('closed');
  });

  // Input: OTHER accepts in a conversation with no proposal, or whose proposal was already declined or accepted
  // Expected status code: 409
  // Expected behavior: no deal is stored and the conversation is unchanged
  // Expected output: { error: 'There is no pending proposal' }
  test.each(ANSWERED_CASES)('$label: 409', async ({ status }: StatusCase) => {
    const conversation = await conversationWithProposal(status);
    const before = await storedConversations(mongo.db);

    const response = await post(app, proposalUrl(conversation.id, '/accept'), {}, { userId: OTHER });

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual(NO_PENDING);
    expect(await storedDeals()).toStrictEqual([]);
    expect(await storedConversations(mongo.db)).toStrictEqual(before);
  });

  // Input: ME accepts ME's own pending proposal
  // Expected status code: 403
  // Expected behavior: no deal is stored and the proposal stays pending
  // Expected output: { error: 'You cannot answer your own proposal' }
  test('Own Proposal: 403', async () => {
    const setup = await pendingDeal();

    const response = await post(app, proposalUrl(setup.conversation.id, '/accept'), {});

    expect(response.status).toBe(403);
    expect(response.body).toStrictEqual(OWN_PROPOSAL);
    expect(await storedDeals()).toStrictEqual([]);
    expect((await mongo.store.conversations.findById(setup.conversation.id))?.proposal?.status).toBe('pending');
  });

  // Input: OTHER accepts ME's pending proposal after the listing or the request was closed or deleted
  // Expected status code: 409
  // Expected behavior: no deal is stored, the proposal stays pending and the other post stays open
  // Expected output: { error: 'This post is no longer available' }
  test.each<{ label: string; kind: 'listing' | 'request'; remove: boolean; after: (string | undefined)[] }>([
    { label: 'Listing Closed', kind: 'listing', remove: false, after: ['closed', 'open'] },
    { label: 'Request Closed', kind: 'request', remove: false, after: ['open', 'closed'] },
    { label: 'Listing Deleted', kind: 'listing', remove: true, after: [undefined, 'open'] },
    { label: 'Request Deleted', kind: 'request', remove: true, after: ['open', undefined] },
  ])('$label: 409', async ({ kind, remove, after }) => {
    const setup = await pendingDeal();
    const posts = mongo.db.collection(kind === 'listing' ? 'listings' : 'requests');
    const filter = { _id: new ObjectId(kind === 'listing' ? setup.listingId : setup.requestId) };
    await (remove ? posts.deleteOne(filter) : posts.updateOne(filter, { $set: { status: 'closed' } }));

    const response = await post(app, proposalUrl(setup.conversation.id, '/accept'), {}, { userId: OTHER });

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual(POST_GONE);
    expect(await storedDeals()).toStrictEqual([]);
    expect((await mongo.store.conversations.findById(setup.conversation.id))?.proposal?.status).toBe('pending');
    expect(await postStatuses(setup)).toStrictEqual(after);
  });

  // Input: OTHER accepts ME's pending proposal of 35, but the open posts already have a deal that is not this proposal's:
  //   the listing was sold to STRANGER, or the same two users agreed 99 on them earlier
  // Expected status code: 409
  // Expected behavior: no second deal is stored, the posts stay open and the proposal stays pending
  // Expected output: { error: 'This post is no longer available' }
  test.each([
    { label: 'Listing Sold To Someone Else', buyerId: STRANGER, price: 35, withRequest: false },
    { label: 'Same Posts At Another Price', buyerId: ME, price: 99, withRequest: true },
  ])('$label: 409', async ({ buyerId, price, withRequest }: { label: string; buyerId: string; price: number; withRequest: boolean }) => {
    const setup = await pendingDeal();
    const posts = { listingId: setup.listingId, requestId: withRequest ? setup.requestId : undefined };
    await makeDeal(mongo.store, { sellerId: OTHER, buyerId }, posts, { agreedPrice: price });

    const response = await post(app, proposalUrl(setup.conversation.id, '/accept'), {}, { userId: OTHER });

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual(POST_GONE);
    expect(await storedDeals()).toHaveLength(1);
    expect(await postStatuses(setup)).toStrictEqual(['open', 'open']);
    expect((await mongo.store.conversations.findById(setup.conversation.id))?.proposal?.status).toBe('pending');
  });

  // Input: OTHER accepts ME's pending proposal of 35 again, after an earlier accept stored the deal and then failed,
  //   either before closing any post or after closing only the listing
  // Expected status code: 201
  // Expected behavior: no second deal is stored; the earlier deal is kept, both posts are closed and the proposal is accepted
  // Expected output: { deal, proposal } with the earlier deal's id and the proposal's status 'accepted'
  test.each([
    { label: 'Nothing Closed Yet', listingClosed: false },
    { label: 'Listing Already Closed', listingClosed: true },
  ])('Retry After An Interrupted Accept, $label: 201', async ({ listingClosed }: { label: string; listingClosed: boolean }) => {
    const setup = await pendingDeal();
    const earlier = await makeDeal(mongo.store, { sellerId: OTHER, buyerId: ME }, setup, { agreedPrice: 35 });
    if (listingClosed) {
      await mongo.db.collection('listings').updateOne({ _id: new ObjectId(setup.listingId) }, { $set: { status: 'closed' } });
    }

    const response = await post(app, proposalUrl(setup.conversation.id, '/accept'), {}, { userId: OTHER });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ deal: { id: earlier.id, agreedPrice: 35 }, proposal: { status: 'accepted' } });
    expect(await storedDeals()).toHaveLength(1);
    expect(await postStatuses(setup)).toStrictEqual(['closed', 'closed']);
    expect((await mongo.store.conversations.findById(setup.conversation.id))?.proposal?.status).toBe('accepted');
  });

  // Input: STRANGER, who is not in the conversation, accepts ME's pending proposal
  // Expected status code: 403
  // Expected behavior: no deal is stored
  // Expected output: { error: 'Forbidden' }
  test('Not A Participant: 403', async () => {
    const setup = await pendingDeal();

    const response = await post(app, proposalUrl(setup.conversation.id, '/accept'), {}, { userId: STRANGER });

    expect(response.status).toBe(403);
    expect(response.body).toStrictEqual({ error: 'Forbidden' });
    expect(await storedDeals()).toStrictEqual([]);
  });

  // Input: an id with no conversation, or an id that is not a valid ObjectId
  // Expected status code: 404
  // Expected behavior: no deal is stored
  // Expected output: { error: 'Not Found' }
  test.each(UNKNOWN_IDS)('$label: 404', async ({ id }: IdCase) => {
    const response = await post(app, proposalUrl(id, '/accept'), {});

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
    expect(await storedDeals()).toStrictEqual([]);
  });

  // Input: no Authorization header, or a token that is not a valid JWT
  // Expected status code: 401
  // Expected behavior: no deal is stored and the proposal stays pending
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ auth, error }: TokenCase) => {
    const setup = await pendingDeal();

    const response = await post(app, proposalUrl(setup.conversation.id, '/accept'), {}, { auth });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
    expect(await storedDeals()).toStrictEqual([]);
  });
});

// Interface POST /api/conversations/:id/proposal/decline
describe('Unmocked: POST /api/conversations/:id/proposal/decline', () => {
  // Input: OTHER declines ME's pending proposal of 35
  // Expected status code: 200
  // Expected behavior: the proposal is stored as declined, no deal is stored and both posts stay open
  // Expected output: the proposal { proposerId: ME, price: 35, status: 'declined', ... }
  test('Decline: 200', async () => {
    const setup = await pendingDeal();

    const response = await post(app, proposalUrl(setup.conversation.id, '/decline'), {}, { userId: OTHER });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ proposerId: ME, price: 35, status: 'declined' });
    expect((await mongo.store.conversations.findById(setup.conversation.id))?.proposal?.status).toBe('declined');
    expect(await storedDeals()).toStrictEqual([]);
    expect(await postStatuses(setup)).toStrictEqual(['open', 'open']);
  });

  // Input: OTHER declines in a conversation with no proposal, or whose proposal was already declined or accepted
  // Expected status code: 409
  // Expected behavior: database is unchanged
  // Expected output: { error: 'There is no pending proposal' }
  test.each(ANSWERED_CASES)('$label: 409', async ({ status }: StatusCase) => {
    const conversation = await conversationWithProposal(status);
    const before = await storedConversations(mongo.db);

    const response = await post(app, proposalUrl(conversation.id, '/decline'), {}, { userId: OTHER });

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual(NO_PENDING);
    expect(await storedConversations(mongo.db)).toStrictEqual(before);
  });

  // Input: ME declines ME's own pending proposal
  // Expected status code: 403
  // Expected behavior: database is unchanged
  // Expected output: { error: 'You cannot answer your own proposal' }
  test('Own Proposal: 403', async () => {
    const setup = await pendingDeal();
    const before = await storedConversations(mongo.db);

    const response = await post(app, proposalUrl(setup.conversation.id, '/decline'), {});

    expect(response.status).toBe(403);
    expect(response.body).toStrictEqual(OWN_PROPOSAL);
    expect(await storedConversations(mongo.db)).toStrictEqual(before);
  });

  // Input: STRANGER, who is not in the conversation, declines ME's pending proposal
  // Expected status code: 403
  // Expected behavior: database is unchanged
  // Expected output: { error: 'Forbidden' }
  test('Not A Participant: 403', async () => {
    const setup = await pendingDeal();
    const before = await storedConversations(mongo.db);

    const response = await post(app, proposalUrl(setup.conversation.id, '/decline'), {}, { userId: STRANGER });

    expect(response.status).toBe(403);
    expect(response.body).toStrictEqual({ error: 'Forbidden' });
    expect(await storedConversations(mongo.db)).toStrictEqual(before);
  });

  // Input: an id with no conversation, or an id that is not a valid ObjectId
  // Expected status code: 404
  // Expected behavior: database is unchanged
  // Expected output: { error: 'Not Found' }
  test.each(UNKNOWN_IDS)('$label: 404', async ({ id }: IdCase) => {
    const response = await post(app, proposalUrl(id, '/decline'), {});

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
    expect(await storedConversations(mongo.db)).toStrictEqual([]);
  });

  // Input: no Authorization header, or a token that is not a valid JWT
  // Expected status code: 401
  // Expected behavior: database is unchanged
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ auth, error }: TokenCase) => {
    const setup = await pendingDeal();
    const before = await storedConversations(mongo.db);

    const response = await post(app, proposalUrl(setup.conversation.id, '/decline'), {}, { auth });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
    expect(await storedConversations(mongo.db)).toStrictEqual(before);
  });
});
