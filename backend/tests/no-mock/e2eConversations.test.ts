import type { Server } from 'node:http';

import request from 'supertest';

import { E2E_LISTING_NAME, E2E_LISTING_PRICE, MAX_SEEDED_MESSAGES, e2ePartnerId } from '../../src/routes/e2e';
import { ME, OTHER, bearer, makeListing } from '../helpers/dealFixtures';
import { startTestApp, stopTestApp } from '../helpers/testApp';
import { createTestStore, type TestStore } from '../helpers/testStore';

let mongo: TestStore;
let app: Server;
let appWithoutSeed: Server;

beforeAll(async () => {
  mongo = await createTestStore();
  app = await startTestApp(mongo.store, true);
  appWithoutSeed = await startTestApp(mongo.store);
});

afterAll(async () => {
  await stopTestApp(app);
  await stopTestApp(appWithoutSeed);
  await mongo.dropAndClose();
});

const COLLECTIONS = ['listings', 'requests', 'users', 'conversations', 'messages', 'deals', 'ratings', 'reputations'];

beforeEach(async () => {
  await Promise.all(
    COLLECTIONS.map(async (name) => {
      await mongo.db.collection(name).deleteMany({});
    })
  );
});

const PARTNER = e2ePartnerId(ME);
const COUNT_ERROR = `messages must be a whole number from 0 to ${MAX_SEEDED_MESSAGES}`;

interface Seeded { listingId: string; conversationId: string }

// A request the seed routes must refuse: on a server without ENABLE_E2E_ROUTES, or without a token.
interface RefusedCase { label: string; server: 'off' | 'on'; auth: boolean; status: number; error: string }
const REFUSED_CASES: RefusedCase[] = [
  { label: 'Off Without ENABLE_E2E_ROUTES', server: 'off', auth: true, status: 404, error: 'Not Found' },
  { label: 'No Token', server: 'on', auth: false, status: 401, error: 'Missing Authorization: Bearer <session token> header' },
];

function call(method: 'post' | 'delete', path: string, options: { server?: Server; auth?: boolean; userId?: string } = {}): request.Test {
  const server = options.server ?? app;
  const sent = method === 'post' ? request(server).post(path) : request(server).delete(path);
  return options.auth === false ? sent : sent.set('Authorization', bearer(options.userId ?? ME));
}

function serverOf(refused: RefusedCase): Server {
  return refused.server === 'off' ? appWithoutSeed : app;
}

async function seedConversation(messages = 0): Promise<Seeded> {
  return (await call('post', `/api/e2e/conversations?messages=${messages}`)).body as Seeded;
}

async function count(collection: string, filter: Record<string, unknown> = {}): Promise<number> {
  const found: number = await mongo.db.collection(collection).countDocuments(filter);
  return found;
}

// Interface POST /api/e2e/listings
describe('Unmocked: POST /api/e2e/listings', () => {
  // Input: POST /api/e2e/listings as ME, with nothing seeded yet
  // Expected status code: 201
  // Expected behavior: the seed partner 'E2E Seller' and their open listing 'E2E lamp' at $30 are saved
  // Expected output: { listingId } of the new listing
  test('Seeds A Listing: 201', async () => {
    const response = await call('post', '/api/e2e/listings');

    expect(response.status).toBe(201);
    const { listingId } = response.body as { listingId: string };
    const listing = await mongo.store.listings.findById(listingId);
    expect(listing).toMatchObject({ ownerId: PARTNER, name: E2E_LISTING_NAME, price: E2E_LISTING_PRICE, status: 'open' });
    expect(await mongo.store.users.findById(PARTNER)).toMatchObject({ firstName: 'E2E', lastName: 'Seller' });
  });

  // Input: POST /api/e2e/listings as ME, after a conversation with 3 messages was seeded
  // Expected status code: 201
  // Expected behavior: the earlier listing, conversation and messages are removed, so only the new listing is left
  // Expected output: { listingId } of the new listing
  test('Seeding Again Starts Over: 201', async () => {
    const earlier = await seedConversation(3);

    const response = await call('post', '/api/e2e/listings');

    expect(response.status).toBe(201);
    expect(await mongo.store.listings.findById(earlier.listingId)).toBeNull();
    expect([await count('listings'), await count('conversations'), await count('messages')]).toStrictEqual([1, 0, 0]);
  });

  // Input: POST /api/e2e/listings on a server without ENABLE_E2E_ROUTES, or with no Authorization header
  // Expected status code: 404 or 401
  // Expected behavior: nothing is saved
  // Expected output: { error } naming the problem
  test.each(REFUSED_CASES)('$label: $status', async (refused: RefusedCase) => {
    const response = await call('post', '/api/e2e/listings', { server: serverOf(refused), auth: refused.auth });

    expect(response.status).toBe(refused.status);
    expect(response.body).toStrictEqual({ error: refused.error });
    expect(await count('listings')).toBe(0);
  });
});

// Interface POST /api/e2e/conversations
describe('Unmocked: POST /api/e2e/conversations', () => {
  // Input: POST /api/e2e/conversations as ME, with no messages parameter
  // Expected status code: 201
  // Expected behavior: the partner's listing and ME's conversation about it are saved, with no messages
  // Expected output: { listingId, conversationId }
  test('No Messages: 201', async () => {
    const response = await call('post', '/api/e2e/conversations');

    expect(response.status).toBe(201);
    const { listingId, conversationId } = response.body as Seeded;
    const conversation = await mongo.store.conversations.findById(conversationId);
    expect(conversation).toMatchObject({ listingId, requestId: null, sellerId: PARTNER, buyerId: ME, postKind: 'listing', lastMessage: null });
    expect(await count('messages')).toBe(0);
  });

  // Input: POST /api/e2e/conversations?messages=40 as ME
  // Expected status code: 201
  // Expected behavior: 40 messages from the partner are saved, 'Message 1' oldest, and the last one is the conversation's lastMessage
  // Expected output: { listingId, conversationId }
  test('Forty Messages: 201', async () => {
    const response = await call('post', `/api/e2e/conversations?messages=${MAX_SEEDED_MESSAGES}`);

    expect(response.status).toBe(201);
    const { conversationId } = response.body as Seeded;
    const newestFirst = await mongo.store.messages.listByConversation(conversationId, MAX_SEEDED_MESSAGES + 1);
    const texts = newestFirst.map((message) => message.text).reverse();
    expect(texts).toStrictEqual(Array.from({ length: MAX_SEEDED_MESSAGES }, (_, i) => `Message ${i + 1}`));
    expect(newestFirst.every((message) => message.senderId === PARTNER)).toBe(true);
    expect((await mongo.store.conversations.findById(conversationId))?.lastMessage).toMatchObject({ senderId: PARTNER, text: 'Message 40' });
  });

  // Input: messages=-1, 41, abc or 1.5, or the parameter given twice
  // Expected status code: 400
  // Expected behavior: nothing is saved
  // Expected output: { error: 'Invalid request', details: ['messages must be a whole number from 0 to 40'] }
  test.each(['messages=-1', 'messages=41', 'messages=abc', 'messages=1.5', 'messages=1&messages=2'])('%s: 400', async (query: string) => {
    const response = await call('post', `/api/e2e/conversations?${query}`);

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Invalid request', details: [COUNT_ERROR] });
    expect([await count('listings'), await count('conversations')]).toStrictEqual([0, 0]);
  });

  // Input: POST /api/e2e/conversations on a server without ENABLE_E2E_ROUTES, or with no Authorization header
  // Expected status code: 404 or 401
  // Expected behavior: nothing is saved
  // Expected output: { error } naming the problem
  test.each(REFUSED_CASES)('$label: $status', async (refused: RefusedCase) => {
    const response = await call('post', '/api/e2e/conversations', { server: serverOf(refused), auth: refused.auth });

    expect(response.status).toBe(refused.status);
    expect(response.body).toStrictEqual({ error: refused.error });
    expect(await count('conversations')).toBe(0);
  });
});

// Interface DELETE /api/e2e/conversations
describe('Unmocked: DELETE /api/e2e/conversations', () => {
  // Input: DELETE /api/e2e/conversations as ME, after ME accepted the partner's proposal in a seeded conversation and
  //   rated the deal, while ME also has a real conversation, listing and deal with OTHER
  // Expected status code: 204
  // Expected behavior: the partner's listing, conversation, messages, deal, rating and reputation are removed;
  //   ME's real conversation, listing and deal with OTHER are kept
  // Expected output: an empty body
  test('Removes Only Seeded Data: 204', async () => {
    const seeded = await seedConversation(2);
    await call('post', `/api/e2e/partner/conversations/${seeded.conversationId}/proposal`).send({ price: 25 });
    const accepted = await call('post', `/api/conversations/${seeded.conversationId}/proposal/accept`);
    const dealId = (accepted.body as { deal: { id: string } }).deal.id;
    await call('post', `/api/deals/${dealId}/ratings`).send({ stars: 5, comment: '' });
    const realListing = await makeListing(mongo.store, OTHER);
    const real = await call('post', '/api/conversations').send({ postId: realListing.id, postKind: 'listing' });
    await mongo.store.deals.insert({ listingId: realListing.id, requestId: null, sellerId: OTHER, buyerId: ME, agreedPrice: 10, createdAt: new Date() });

    const response = await call('delete', '/api/e2e/conversations');

    expect(response.status).toBe(204);
    expect(await count('listings')).toBe(1);
    expect(await count('conversations')).toBe(1);
    expect(await mongo.store.conversations.findById(String(real.body.id))).not.toBeNull();
    expect([await count('messages'), await count('ratings')]).toStrictEqual([0, 0]);
    expect(await count('deals')).toBe(1);
    expect(await mongo.store.reputations.find(PARTNER)).toBeNull();
  });

  // Input: DELETE /api/e2e/conversations on a server without ENABLE_E2E_ROUTES, or with no Authorization header
  // Expected status code: 404 or 401
  // Expected behavior: the seeded conversation is kept
  // Expected output: { error } naming the problem
  test.each(REFUSED_CASES)('$label: $status', async (refused: RefusedCase) => {
    await seedConversation(1);

    const response = await call('delete', '/api/e2e/conversations', { server: serverOf(refused), auth: refused.auth });

    expect(response.status).toBe(refused.status);
    expect(response.body).toStrictEqual({ error: refused.error });
    expect([await count('conversations'), await count('messages')]).toStrictEqual([1, 1]);
  });
});

// Interface POST /api/e2e/partner/conversations/:id/messages
describe('Unmocked: POST /api/e2e/partner/conversations/:id/messages', () => {
  // Input: { text: 'Still available' } as ME, on ME's seeded conversation
  // Expected status code: 201
  // Expected behavior: the message is saved as sent by the partner, and ME reads it through the real route
  // Expected output: the message, with senderId the partner
  test('Partner Sends A Message: 201', async () => {
    const seeded = await seedConversation();

    const response = await call('post', `/api/e2e/partner/conversations/${seeded.conversationId}/messages`).send({ text: 'Still available' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ senderId: PARTNER, text: 'Still available' });
    const mine = await request(app).get(`/api/conversations/${seeded.conversationId}/messages`).set('Authorization', bearer(ME));
    expect(mine.body).toMatchObject({ messages: [{ senderId: PARTNER, text: 'Still available' }] });
  });

  // Input: { text: 'hi' } as ME, on ME's real conversation with OTHER, which ME's partner is not in
  // Expected status code: 403
  // Expected behavior: nothing is saved
  // Expected output: { error: 'Forbidden' }
  test('Not The Partner Conversation: 403', async () => {
    const listing = await makeListing(mongo.store, OTHER);
    const real = await call('post', '/api/conversations').send({ postId: listing.id, postKind: 'listing' });

    const response = await call('post', `/api/e2e/partner/conversations/${String(real.body.id)}/messages`).send({ text: 'hi' });

    expect(response.status).toBe(403);
    expect(response.body).toStrictEqual({ error: 'Forbidden' });
    expect(await count('messages')).toBe(0);
  });

  // Input: { text: 'hi' } on a server without ENABLE_E2E_ROUTES, or with no Authorization header
  // Expected status code: 404 or 401
  // Expected behavior: nothing is saved
  // Expected output: { error } naming the problem
  test.each(REFUSED_CASES)('$label: $status', async (refused: RefusedCase) => {
    const seeded = await seedConversation();

    const sent = call('post', `/api/e2e/partner/conversations/${seeded.conversationId}/messages`, { server: serverOf(refused), auth: refused.auth });
    const response = await sent.send({ text: 'hi' });

    expect(response.status).toBe(refused.status);
    expect(response.body).toStrictEqual({ error: refused.error });
    expect(await count('messages')).toBe(0);
  });
});

// Interface POST /api/e2e/partner/conversations/:id/proposal
describe('Unmocked: POST /api/e2e/partner/conversations/:id/proposal', () => {
  // Input: { price: 25 } as ME on ME's seeded conversation; ME then accepts it through the real route
  // Expected status code: 201 for the proposal, 201 for the accept
  // Expected behavior: the proposal is saved as the partner's; accepting it records a deal in which ME bought the
  //   partner's listing for 25, and closes the listing
  // Expected output: the proposal, with proposerId the partner and status 'pending'
  test('Partner Proposes And The Caller Accepts: 201', async () => {
    const seeded = await seedConversation();

    const response = await call('post', `/api/e2e/partner/conversations/${seeded.conversationId}/proposal`).send({ price: 25 });
    const accepted = await call('post', `/api/conversations/${seeded.conversationId}/proposal/accept`);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ proposerId: PARTNER, price: 25, status: 'pending' });
    expect(accepted.status).toBe(201);
    const deals = await mongo.db.collection('deals').find().toArray();
    expect(deals).toMatchObject([{ listingId: seeded.listingId, sellerId: PARTNER, buyerId: ME, agreedPrice: 25 }]);
    expect((await mongo.store.listings.findById(seeded.listingId))?.status).toBe('closed');
  });
});

// Interface POST /api/e2e/partner/conversations/:id/proposal/decline
describe('Unmocked: POST /api/e2e/partner/conversations/:id/proposal/decline', () => {
  // Input: ME proposes 20 through the real route, then the partner declines it
  // Expected status code: 200
  // Expected behavior: ME's proposal is saved as declined and no deal is recorded
  // Expected output: the proposal, with proposerId ME and status 'declined'
  test('Partner Declines The Caller Proposal: 200', async () => {
    const seeded = await seedConversation();
    await call('post', `/api/conversations/${seeded.conversationId}/proposal`).send({ price: 20 });

    const response = await call('post', `/api/e2e/partner/conversations/${seeded.conversationId}/proposal/decline`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ proposerId: ME, price: 20, status: 'declined' });
    expect(await count('deals')).toBe(0);
  });
});
