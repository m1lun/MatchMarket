import type { Server } from 'node:http';

import request from 'supertest';

import { E2E_LISTING_NAME, e2ePartnerId } from '../../src/testSupport/e2e';
import { ME, OTHER, bearer, makeRequest } from '../helpers/dealFixtures';
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

const COLLECTIONS = ['listings', 'requests', 'users', 'conversations', 'messages', 'deals'];

beforeEach(async () => {
  await Promise.all(
    COLLECTIONS.map(async (name) => {
      await mongo.db.collection(name).deleteMany({});
    })
  );
});

interface Seeded { listingId: string; conversationId: string }
interface Post { id: string; ownerId: string; name: string }

function as(userId: string, method: 'get' | 'post', path: string): request.Test {
  const sent = method === 'get' ? request(app).get(path) : request(app).post(path);
  return sent.set('Authorization', bearer(userId));
}

async function seedConversation(userId: string): Promise<Seeded> {
  return (await as(userId, 'post', '/api/e2e/conversations')).body as Seeded;
}

async function browsedListings(userId: string): Promise<Post[]> {
  return ((await as(userId, 'get', '/api/feed/listings')).body as { listings: Post[] }).listings;
}

async function recommendedNames(userId: string, postId: string): Promise<string[]> {
  const body = (await as(userId, 'get', `/api/feed?postId=${postId}`)).body as { matches: { post: Post }[] };
  return body.matches.map((match) => match.post.name);
}

// Interface GET /api/feed/listings
describe('Unmocked: test posts in the browse feed', () => {
  // Input: ME seeds the test seller's listing, then OTHER browses listings
  // Expected status code: 200
  // Expected behavior: the test listing is left out of another user's feed
  // Expected output: { listings } without the test seller's listing
  test('Hidden From Another User', async () => {
    await seedConversation(ME);

    const listings = await browsedListings(OTHER);

    expect(listings.some((listing) => listing.ownerId === e2ePartnerId(ME))).toBe(false);
  });

  // Input: ME seeds the test seller's listing, then ME browses listings
  // Expected status code: 200
  // Expected behavior: the caller still sees their own test seller's listing
  // Expected output: { listings } with 'E2E lamp'
  test("Shown To The Tester's Own Feed", async () => {
    const { listingId } = await seedConversation(ME);

    const listings = await browsedListings(ME);

    expect(listings.map((listing) => listing.id)).toContain(listingId);
  });

  // Input: ME and OTHER both seed their test seller's listing, then ME browses listings
  // Expected status code: 200
  // Expected behavior: a tester never sees another tester's test listing
  // Expected output: { listings } with only ME's test listing
  test("Another Tester's Listing Hidden", async () => {
    const mine = await seedConversation(ME);
    const theirs = await seedConversation(OTHER);

    const ids = (await browsedListings(ME)).map((listing) => listing.id);

    expect(ids).toContain(mine.listingId);
    expect(ids).not.toContain(theirs.listingId);
  });
});

// Interface GET /api/feed
describe('Unmocked: test posts in recommendations', () => {
  // Input: ME seeds the test listing (a lamp at $30); OTHER and ME each have an open request for a lamp
  // Expected status code: 200
  // Expected behavior: the test listing is a candidate only for its own tester
  // Expected output: OTHER's matches without 'E2E lamp'; ME's matches with it
  test('Candidate Only For The Tester', async () => {
    await seedConversation(ME);
    const theirRequest = await makeRequest(mongo.store, OTHER, { category: 'lamp' });
    const myRequest = await makeRequest(mongo.store, ME, { category: 'lamp' });

    expect(await recommendedNames(OTHER, theirRequest.id)).not.toContain(E2E_LISTING_NAME);
    expect(await recommendedNames(ME, myRequest.id)).toContain(E2E_LISTING_NAME);
  });
});

// Interface POST /api/conversations
describe('Unmocked: conversations about test posts', () => {
  // Input: ME seeds the test listing; OTHER opens a conversation about it by its id
  // Expected status code: 404
  // Expected behavior: no conversation is created, as if the post did not exist
  // Expected output: { error: 'Not Found' }
  test("Another User Cannot Open One: 404", async () => {
    const { listingId } = await seedConversation(ME);

    const response = await as(OTHER, 'post', '/api/conversations').send({ postId: listingId, postKind: 'listing' });

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
    expect(await mongo.db.collection('conversations').countDocuments({ buyerId: OTHER })).toBe(0);
  });

  // Input: ME seeds the test listing; ME opens a conversation about it
  // Expected status code: 200
  // Expected behavior: the tester can still talk to their own test seller (the seeded conversation is returned)
  // Expected output: the conversation
  test('The Tester Can Open One: 200', async () => {
    const { listingId, conversationId } = await seedConversation(ME);

    const response = await as(ME, 'post', '/api/conversations').send({ postId: listingId, postKind: 'listing' });

    expect(response.status).toBe(200);
    expect((response.body as { id: string }).id).toBe(conversationId);
  });
});

// Interface /api/e2e/partner/conversations
describe('Unmocked: the test seller only acts in its tester’s own conversation', () => {
  // Input: a route of the conversation API that the test seller no longer has
  // Expected status code: 404
  // Expected behavior: nothing is created or answered
  // Expected output: { error: 'Not Found' }
  test.each([
    { label: 'Open A Conversation', method: 'post' as const, path: '' },
    { label: 'List The Inbox', method: 'get' as const, path: '' },
    { label: 'Read Messages', method: 'get' as const, path: '/{id}/messages' },
    { label: 'Accept A Proposal', method: 'post' as const, path: '/{id}/proposal/accept' },
  ])('$label: 404', async ({ method, path }) => {
    const { conversationId } = await seedConversation(ME);

    const response = await as(ME, method, `/api/e2e/partner/conversations${path.replace('{id}', conversationId)}`).send({});

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
  });

  // Input: ME acts as their test seller in OTHER's seeded conversation
  // Expected status code: 403
  // Expected behavior: nothing is saved in OTHER's conversation
  // Expected output: { error: 'Forbidden' }
  test.each([
    { label: 'Send A Message', path: 'messages', body: { text: 'hi' } },
    { label: 'Propose A Price', path: 'proposal', body: { price: 10 } },
    { label: 'Decline A Proposal', path: 'proposal/decline', body: {} },
  ])("$label In Another User's Conversation: 403", async ({ path, body }) => {
    const theirs = await seedConversation(OTHER);

    const response = await as(ME, 'post', `/api/e2e/partner/conversations/${theirs.conversationId}/${path}`).send(body);

    expect(response.status).toBe(403);
    expect(response.body).toStrictEqual({ error: 'Forbidden' });
    expect(await mongo.db.collection('messages').countDocuments({ conversationId: theirs.conversationId })).toBe(0);
  });

  // Input: ME has a real conversation with OTHER; ME acts as their test seller in it
  // Expected status code: 403
  // Expected behavior: the test seller cannot reach a real user
  // Expected output: { error: 'Forbidden' }
  test("Message In A Real User's Conversation: 403", async () => {
    const { listingId } = await seedConversation(OTHER);
    await mongo.db.collection('listings').updateOne({}, { $set: { ownerId: OTHER } });
    const opened = await as(ME, 'post', '/api/conversations').send({ postId: listingId, postKind: 'listing' });
    const conversationId = (opened.body as { id: string }).id;

    const response = await as(ME, 'post', `/api/e2e/partner/conversations/${conversationId}/messages`).send({ text: 'hi' });

    expect(response.status).toBe(403);
    expect(await mongo.db.collection('messages').countDocuments({ conversationId })).toBe(0);
  });

  // Input: ME acts as their test seller in ME's own seeded conversation
  // Expected status code: 201
  // Expected behavior: the message is saved from the test seller
  // Expected output: the message
  test('Message In Own Conversation: 201', async () => {
    const { conversationId } = await seedConversation(ME);

    const response = await as(ME, 'post', `/api/e2e/partner/conversations/${conversationId}/messages`).send({ text: 'hi' });

    expect(response.status).toBe(201);
    expect((response.body as { senderId: string }).senderId).toBe(e2ePartnerId(ME));
  });
});
