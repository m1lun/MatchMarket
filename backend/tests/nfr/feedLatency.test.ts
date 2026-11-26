import type { Server } from 'node:http';

import request from 'supertest';

import { env } from '../../src/shared/config/env';
import { ME, bearer, clearDealData } from '../helpers/dealFixtures';
import { CANDIDATES, saveFeedWorkload } from '../helpers/feedWorkload';
import { startTestApp, stopTestApp } from '../helpers/testApp';
import { createTestStore, type TestStore } from '../helpers/testStore';

// NFR 1: the first page of the ranked feed returns within 1 second for 95% of requests,
// with 1,000 open candidate posts in the same category, not counting the travel-time lookup.
const REQUESTS = 100;
const PERCENTILE = 0.95;
const LATENCY_LIMIT_MS = 1000;
const PAGE_SIZE = 20;

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
  // NFR 1 excludes the travel-time lookup, which NFR 2 bounds separately.
  jest.replaceProperty(env, 'orsApiKey', undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function percentile(sortedMs: number[], fraction: number): number {
  const index = Math.min(sortedMs.length - 1, Math.ceil(fraction * sortedMs.length) - 1);
  return sortedMs.at(index) ?? Number.NaN;
}

// Interface GET /api/feed
describe('NFR 1: GET /api/feed ranking latency', () => {
  // Input: my request for a chair with a hard maximum of $100 and soft preferences for condition, brand and
  // colour, and 1,000 of another user's open chair listings that all meet the hard requirements
  // Expected status code: 200 for each of 100 requests for the first page
  // Expected behavior: every candidate is filtered and ranked on each request, and 95% of requests finish within 1 second
  // Expected output: 20 ranked matches per page, with nextCursor "20", and a last page that ends at the 1,000th match
  test('First Page Within 1 Second For 95% Of Requests With 1,000 Candidates', async () => {
    const buyerRequest = await saveFeedWorkload(mongo.store);
    const feed = (cursor?: string): request.Test =>
      request(app)
        .get(`/api/feed?postId=${buyerRequest.id}${cursor === undefined ? '' : `&cursor=${cursor}`}`)
        .set('Authorization', bearer(ME));

    // The last page shows that all 1,000 candidates met the hard requirements and were ranked.
    const lastPage = await feed(String(CANDIDATES - PAGE_SIZE));
    expect(lastPage.status).toBe(200);
    expect(lastPage.body).toMatchObject({ nextCursor: null });
    expect((lastPage.body as { matches: unknown[] }).matches).toHaveLength(PAGE_SIZE);
    // One request first, so start-up costs such as compiling the route are not counted as a slow request.
    await feed();

    const timesMs: number[] = [];
    for (let i = 0; i < REQUESTS; i += 1) {
      const started = performance.now();
      const response = await feed();
      timesMs.push(performance.now() - started);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ nextCursor: String(PAGE_SIZE) });
      expect((response.body as { matches: unknown[] }).matches).toHaveLength(PAGE_SIZE);
    }

    const sorted = [...timesMs].sort((a, b) => a - b);
    const p95 = percentile(sorted, PERCENTILE);
    const mean = timesMs.reduce((sum, ms) => sum + ms, 0) / timesMs.length;
    console.info(
      `NFR 1: ${REQUESTS} requests, ${CANDIDATES} candidates: ` +
        `p50 ${percentile(sorted, 0.5).toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, ` +
        `max ${(sorted[sorted.length - 1] ?? 0).toFixed(1)} ms, mean ${mean.toFixed(1)} ms (limit ${LATENCY_LIMIT_MS} ms at p95)`
    );
    expect(p95).toBeLessThan(LATENCY_LIMIT_MS);
  }, 120_000);
});
