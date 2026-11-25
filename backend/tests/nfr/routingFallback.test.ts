import type { Server } from 'node:http';

import request from 'supertest';

import { env } from '../../src/shared/config/env';
import { ROUTING_TIMEOUT_MS } from '../../src/components/matching/logic/travelTime';
import { ME, bearer, clearDealData } from '../helpers/dealFixtures';
import { CANDIDATES, saveFeedWorkload } from '../helpers/feedWorkload';
import { startTestApp, stopTestApp } from '../helpers/testApp';
import { createTestStore, type TestStore } from '../helpers/testStore';

// NFR 2: if the routing service fails, times out or is rate-limited, the feed still returns
// its ranked matches within 3 seconds, without travel times.
const FEED_LIMIT_MS = 3000;
// A timed-out request ends when the timeout fires, give or take the timer's resolution.
const TIMER_SLACK_MS = 50;
const PAGE_SIZE = 20;
const SECONDS_PER_MINUTE = 60;

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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// A working routing service: a travel time of i + 1 minutes to the i-th result.
function workingRoutingAnswer(): Response {
  return jsonResponse(200, { durations: [Array.from({ length: PAGE_SIZE }, (_unused, i) => (i + 1) * SECONDS_PER_MINUTE)] });
}

interface FeedPage {
  matches: { post: { id: string }; score: number; travelMinutes: number | null }[];
  travelTimesAvailable: boolean;
  nextCursor: string | null;
}

interface TimedFeed {
  withRouting: FeedPage;
  withoutRouting: request.Response;
  elapsedMs: number;
}

// The NFR 1 workload of 1,000 candidates. First the feed with a working routing service, then,
// with the failure installed, one timed request for the same feed.
async function timeFeed(fetchSpy: jest.SpyInstance, installFailure: () => void): Promise<TimedFeed> {
  const buyerRequest = await saveFeedWorkload(mongo.store);
  const feed = (): request.Test => request(app).get(`/api/feed?postId=${buyerRequest.id}`).set('Authorization', bearer(ME));

  fetchSpy.mockResolvedValueOnce(workingRoutingAnswer());
  const withRouting = await feed();
  expect(withRouting.status).toBe(200);
  expect(withRouting.body).toMatchObject({ travelTimesAvailable: true });

  installFailure();
  const started = performance.now();
  const withoutRouting = await feed();
  return { withRouting: withRouting.body as FeedPage, withoutRouting, elapsedMs: performance.now() - started };
}

// The same 20 matches, in the same ranked order, as with a working routing service, but without travel times.
// Each feed asks the routing service once, for the 20 results on the first page.
function expectRankedWithoutTravelTimes({ withRouting, withoutRouting }: TimedFeed, fetchSpy: jest.SpyInstance): void {
  expect(withoutRouting.status).toBe(200);
  const page = withoutRouting.body as FeedPage;
  expect(page).toMatchObject({ travelTimesAvailable: false, nextCursor: String(PAGE_SIZE) });
  expect(page.matches.map((match) => match.post.id)).toEqual(withRouting.matches.map((match) => match.post.id));
  const scores = page.matches.map((match) => match.score);
  expect(scores).toEqual([...scores].sort((a, b) => b - a));
  expect(page.matches.every((match) => match.travelMinutes === null)).toBe(true);

  expect(fetchSpy).toHaveBeenCalledTimes(2);
  for (const [, init] of fetchSpy.mock.calls as [unknown, { body: string }][]) {
    expect((JSON.parse(init.body) as { destinations: number[] }).destinations).toHaveLength(PAGE_SIZE);
  }
}

function logTime(failure: string, elapsedMs: number): void {
  console.info(
    `NFR 2: routing service ${failure}, ${CANDIDATES} candidates: feed answered in ${elapsedMs.toFixed(0)} ms (limit ${FEED_LIMIT_MS} ms)`
  );
}

// Interface GET /api/feed
describe('NFR 2: GET /api/feed without the routing service', () => {
  // Mocked behavior: OpenRouteService never answers
  // Input: the id of my open request, which 1,000 of another user's open listings match
  // Expected status code: 200
  // Expected behavior: the routing request is abandoned after ROUTING_TIMEOUT_MS, and the feed answers within 3 seconds
  // Expected output: the same first page of 20 ranked matches as with a working routing service, with travelMinutes
  // null and travelTimesAvailable false
  test('Routing Service Never Answers', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    const timed = await timeFeed(fetchSpy, () => fetchSpy.mockImplementation(hangUntilAborted));
    logTime('never answers', timed.elapsedMs);

    expectRankedWithoutTravelTimes(timed, fetchSpy);
    expect(timed.elapsedMs).toBeGreaterThanOrEqual(ROUTING_TIMEOUT_MS - TIMER_SLACK_MS);
    expect(timed.elapsedMs).toBeLessThan(FEED_LIMIT_MS);
  }, 30_000);

  // Mocked behavior: OpenRouteService answers 429 (rate-limited) or 500 (failed), or the connection is refused
  // Input: the id of my open request, which 1,000 of another user's open listings match
  // Expected status code: 200
  // Expected behavior: the feed does not wait for the timeout, and answers within 3 seconds
  // Expected output: the same first page of 20 ranked matches as with a working routing service, with travelMinutes
  // null and travelTimesAvailable false
  test.each([
    { label: 'Is Rate-Limited', failure: 'is rate-limited (429)', install: (spy: jest.SpyInstance) => spy.mockResolvedValue(jsonResponse(429, { error: 'unavailable' })) },
    { label: 'Fails', failure: 'fails (500)', install: (spy: jest.SpyInstance) => spy.mockResolvedValue(jsonResponse(500, { error: 'unavailable' })) },
    { label: 'Is Unreachable', failure: 'is unreachable', install: (spy: jest.SpyInstance) => spy.mockRejectedValue(new TypeError('fetch failed')) },
  ])('Routing Service $label', async ({ failure, install }: { label: string; failure: string; install: (spy: jest.SpyInstance) => void }) => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    const timed = await timeFeed(fetchSpy, () => {
      install(fetchSpy);
    });
    logTime(failure, timed.elapsedMs);

    expectRankedWithoutTravelTimes(timed, fetchSpy);
    expect(timed.elapsedMs).toBeLessThan(FEED_LIMIT_MS);
  }, 30_000);
});
