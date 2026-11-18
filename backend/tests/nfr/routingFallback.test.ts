import type { Server } from 'node:http';

import request from 'supertest';

import { env } from '../../src/config/env';
import { ROUTING_TIMEOUT_MS } from '../../src/matching/travelTime';
import { ME, OTHER, bearer, clearDealData, makeListing, makeRequest } from '../helpers/dealFixtures';
import { startTestApp, stopTestApp } from '../helpers/testApp';
import { createTestStore, type TestStore } from '../helpers/testStore';

// NFR 2: if the routing service fails, times out or is rate-limited, the feed still returns
// its ranked matches within 3 seconds, without travel times.
const FEED_LIMIT_MS = 3000;
// A timed-out request ends when the timeout fires, give or take the timer's resolution.
const TIMER_SLACK_MS = 50;

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
  jest.replaceProperty(env, 'orsApiKey', 'test-ors-key');
});

afterEach(() => {
  jest.restoreAllMocks();
});

// A routing service that never answers: the request only ends when the feed's timeout aborts it.
function hangUntilAborted(_input: unknown, init?: Parameters<typeof fetch>[1]): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new Error('aborted'));
    });
  });
}

function routingAnswer(status: number): Response {
  return new Response(JSON.stringify({ error: 'unavailable' }), { status, headers: { 'Content-Type': 'application/json' } });
}

interface TimedFeed {
  response: request.Response;
  elapsedMs: number;
  listingId: string;
}

// My request and one matching listing, then one timed request for the request's feed.
async function timeFeed(): Promise<TimedFeed> {
  const buyerRequest = await makeRequest(mongo.store, ME);
  const listing = await makeListing(mongo.store, OTHER);
  const started = performance.now();
  const response = await request(app).get(`/api/feed?postId=${buyerRequest.id}`).set('Authorization', bearer(ME));
  return { response, elapsedMs: performance.now() - started, listingId: listing.id };
}

function expectRankedWithoutTravelTimes({ response, listingId }: TimedFeed): void {
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    matches: [{ post: { id: listingId }, travelMinutes: null }],
    travelTimesAvailable: false,
  });
}

function logTime(failure: string, elapsedMs: number): void {
  console.info(`NFR 2: routing service ${failure}: feed answered in ${elapsedMs.toFixed(0)} ms (limit ${FEED_LIMIT_MS} ms)`);
}

// Interface GET /api/feed
describe('NFR 2: GET /api/feed without the routing service', () => {
  // Mocked behavior: OpenRouteService never answers
  // Input: the id of my open request, which one listing matches
  // Expected status code: 200
  // Expected behavior: the routing request is abandoned after ROUTING_TIMEOUT_MS, and the feed answers within 3 seconds
  // Expected output: the ranked match with travelMinutes null and travelTimesAvailable false
  test('Routing Service Never Answers', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(hangUntilAborted);

    const timed = await timeFeed();
    logTime('never answers', timed.elapsedMs);

    expectRankedWithoutTravelTimes(timed);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(timed.elapsedMs).toBeGreaterThanOrEqual(ROUTING_TIMEOUT_MS - TIMER_SLACK_MS);
    expect(timed.elapsedMs).toBeLessThan(FEED_LIMIT_MS);
  });

  // Mocked behavior: OpenRouteService answers 429 (rate-limited) or 500 (failed), or the connection is refused
  // Input: the id of my open request, which one listing matches
  // Expected status code: 200
  // Expected behavior: the feed does not wait for the timeout, and answers within 3 seconds
  // Expected output: the ranked match with travelMinutes null and travelTimesAvailable false
  test.each([
    { label: 'Is Rate-Limited', failure: 'is rate-limited (429)', install: (spy: jest.SpyInstance) => spy.mockResolvedValue(routingAnswer(429)) },
    { label: 'Fails', failure: 'fails (500)', install: (spy: jest.SpyInstance) => spy.mockResolvedValue(routingAnswer(500)) },
    { label: 'Is Unreachable', failure: 'is unreachable', install: (spy: jest.SpyInstance) => spy.mockRejectedValue(new TypeError('fetch failed')) },
  ])('Routing Service $label', async ({ failure, install }: { label: string; failure: string; install: (spy: jest.SpyInstance) => void }) => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    install(fetchSpy);

    const timed = await timeFeed();
    logTime(failure, timed.elapsedMs);

    expectRankedWithoutTravelTimes(timed);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(timed.elapsedMs).toBeLessThan(FEED_LIMIT_MS);
  });
});
