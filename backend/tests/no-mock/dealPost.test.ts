import type { Server } from 'node:http';

import request from 'supertest';

import type { Store } from '../../src/shared/store/types';
import { ME, OTHER, bearer, clearDealData, makeListing, makeRequest } from '../helpers/dealFixtures';
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
  await clearDealData(mongo.db);
});

const UNKNOWN_ID = '6ad40b88e74dd3678bfef8f3';

interface TokenCase { label: string; header: string | undefined; error: string }
interface StatusCase { label: string; status: 'open' | 'closed' }
interface IdCase { label: string; id: string }
interface RouteCase {
  kind: 'listings' | 'requests';
  make: (store: Store, ownerId: string, status: 'open' | 'closed') => Promise<{ id: string }>;
}

function asJson(post: unknown): unknown {
  return JSON.parse(JSON.stringify(post));
}

function sharedCases({ kind, make }: RouteCase): void {
  function getPost(id: string): request.Test {
    return request(app).get(`/api/feed/${kind}/${id}`).set('Authorization', bearer(ME));
  }

  // Input: GET for a post with no Authorization header, or with a token that is not a valid JWT
  // Expected status code: 401
  // Expected behavior: request is rejected before the database is read
  // Expected output: { error } naming the auth problem
  test.each([
    { label: 'No Token', header: undefined, error: 'Missing Authorization: Bearer <session token> header' },
    { label: 'Garbage Token', header: 'Bearer not-a-token', error: 'Invalid or expired session token' },
  ])('$label: 401', async ({ header, error }: TokenCase) => {
    const post = await make(mongo.store, OTHER, 'open');
    const call = request(app).get(`/api/feed/${kind}/${post.id}`);
    const response = await (header === undefined ? call : call.set('Authorization', header));

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
  });

  // Input: GET as ME for another user's open post, or their closed post
  // Expected status code: 200
  // Expected behavior: a deal card can open its post even after the post is closed
  // Expected output: the whole post
  test.each<StatusCase>([
    { label: 'Open Post', status: 'open' },
    { label: 'Closed Post', status: 'closed' },
  ])('$label', async ({ status }: StatusCase) => {
    const post = await make(mongo.store, OTHER, status);

    const response = await getPost(post.id);

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual(asJson(post));
  });

  // Input: an id that is not 24 hex characters, or a well-formed id with no post
  // Expected status code: 404
  // Expected behavior: the post is not found rather than the request failing
  // Expected output: { error: 'Not Found' }
  test.each<IdCase>([
    { label: 'Malformed Id', id: 'nope' },
    { label: 'Twelve Character Id', id: 'aaaaaaaaaaaa' },
    { label: 'Unknown Id', id: UNKNOWN_ID },
  ])('$label: 404', async ({ id }: IdCase) => {
    await make(mongo.store, OTHER, 'open');

    const response = await getPost(id);

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
  });
}

// Interface GET /api/feed/listings/:id
describe('Unmocked: GET /api/feed/listings/:id', () => {
  sharedCases({ kind: 'listings', make: (store, ownerId, status) => makeListing(store, ownerId, { status }) });
});

// Interface GET /api/feed/requests/:id
describe('Unmocked: GET /api/feed/requests/:id', () => {
  sharedCases({ kind: 'requests', make: (store, ownerId, status) => makeRequest(store, ownerId, { status }) });
});
