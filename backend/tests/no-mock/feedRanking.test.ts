import type { Server } from 'node:http';

import request from 'supertest';

import { env } from '../../src/shared/config/env';
import type { FieldValue, PostField, RequestField } from '../../src/shared/models/common';
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
  // Without a key the feed never calls the routing service.
  jest.replaceProperty(env, 'orsApiKey', undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function requestField(key: string, value: FieldValue, rule: Pick<RequestField, 'hard' | 'importance'>): RequestField {
  const type = typeof value === 'number' ? 'number' : 'text';
  return { key, label: key, kind: 'builtin', type, value, ...rule };
}

function soft(key: string, value: FieldValue, importance?: number): RequestField {
  return requestField(key, value, importance === undefined ? { hard: false } : { hard: false, importance });
}

function hard(key: string, value: FieldValue): RequestField {
  return requestField(key, value, { hard: true });
}

function listingField(key: string, value: string): PostField {
  return { key, label: key, kind: 'builtin', type: 'text', value };
}

interface FeedMatch {
  post: { id: string };
  score: number;
}

// My request with these fields, and the feed for it.
async function feedFor(requestFields: RequestField[]): Promise<FeedMatch[]> {
  const buyerRequest = await makeRequest(mongo.store, ME, { requestFields });
  const response = await request(app).get(`/api/feed?postId=${buyerRequest.id}`).set('Authorization', bearer(ME));
  expect(response.status).toBe(200);
  return (response.body as { matches: FeedMatch[] }).matches;
}

function ids(matches: FeedMatch[]): string[] {
  return matches.map((match) => match.post.id);
}

function scoreOf(matches: FeedMatch[], id: string): number | undefined {
  return matches.find((match) => match.post.id === id)?.score;
}

// With the default weights each part counts for a quarter. These listings are at the
// request's location, so distance scores 1. Without a price or a soft preference to
// compare, price and match score 0.5, and a good condition scores 0.5.
function expectedScore(parts: { price?: number; condition?: number; match?: number }): number {
  return ((parts.price ?? 0.5) + (parts.condition ?? 0.5) + 1 + (parts.match ?? 0.5)) / 4;
}

// Interface GET /api/feed
describe('Unmocked: GET /api/feed ranking', () => {
  // Input: my request with a soft maximum of $100, and identical listings at $105 and then $140
  // Expected status code: 200
  // Expected behavior: being further over the budget costs more, even though the $140 listing is newer
  // Expected output: the $105 listing first
  test('Soft Max Price Closer To The Budget Ranks First', async () => {
    const closer = await makeListing(mongo.store, OTHER, { price: 105 });
    const further = await makeListing(mongo.store, OTHER, { price: 140 });

    const matches = await feedFor([soft('price', 100, 3)]);

    expect(ids(matches)).toEqual([closer.id, further.id]);
  });

  // Input: my request with a soft maximum of $100, and listings at $100, $150 and $400
  // Expected status code: 200
  // Expected behavior: the penalty grows up to 50% over the budget, then stops
  // Expected output: price scores 0 at the maximum, and -0.5 at both $150 and $400
  test('Soft Max Price Penalty Stops At 50% Over', async () => {
    const atBudget = await makeListing(mongo.store, OTHER, { price: 100 });
    const halfOver = await makeListing(mongo.store, OTHER, { price: 150 });
    const farOver = await makeListing(mongo.store, OTHER, { price: 400 });

    const matches = await feedFor([soft('price', 100, 3)]);

    expect(scoreOf(matches, atBudget.id)).toBeCloseTo(expectedScore({ price: 0 }));
    expect(scoreOf(matches, halfOver.id)).toBeCloseTo(expectedScore({ price: -0.5 }));
    expect(scoreOf(matches, farOver.id)).toBeCloseTo(expectedScore({ price: -0.5 }));
  });

  // Input: my request with a soft maximum of $0, and listings at $0 and $10
  // Expected status code: 200
  // Expected behavior: any price is too far over a budget of nothing to measure
  // Expected output: price scores 1 for the free listing, and -0.5 for the other
  test('Soft Max Price Of Zero', async () => {
    const free = await makeListing(mongo.store, OTHER, { price: 0 });
    const paid = await makeListing(mongo.store, OTHER, { price: 10 });

    const matches = await feedFor([soft('price', 0, 3)]);

    expect(ids(matches)).toEqual([free.id, paid.id]);
    expect(scoreOf(matches, free.id)).toBeCloseTo(expectedScore({ price: 1 }));
    expect(scoreOf(matches, paid.id)).toBeCloseTo(expectedScore({ price: -0.5 }));
  });

  // Input: my request with a soft minimum of good, and identical good and fair listings
  // Expected status code: 200
  // Expected behavior: the listing below the minimum is ranked lower
  // Expected output: the good listing first
  test('Soft Min Condition Below The Minimum Ranks Lower', async () => {
    const good = await makeListing(mongo.store, OTHER, { condition: 'good' });
    const fair = await makeListing(mongo.store, OTHER, { condition: 'fair' });

    const matches = await feedFor([soft('condition', 'good', 3)]);

    expect(ids(matches)).toEqual([good.id, fair.id]);
  });

  // Input: my request with a soft minimum of good and a hard maximum of $50, a fair listing at $10 and a good one at $25
  // Expected status code: 200
  // Expected behavior: the penalty outweighs the price difference, which the condition scale alone would not
  // Expected output: the good listing first
  test('Soft Min Condition Penalty Outweighs A Lower Price', async () => {
    const good = await makeListing(mongo.store, OTHER, { condition: 'good', price: 25 });
    const fair = await makeListing(mongo.store, OTHER, { condition: 'fair', price: 10 });

    const matches = await feedFor([hard('price', 50), soft('condition', 'good', 3)]);

    expect(ids(matches)).toEqual([good.id, fair.id]);
  });

  // Input: my request with a soft minimum of good, and a listing in each condition from new to poor
  // Expected status code: 200
  // Expected behavior: only listings below the minimum lose score, and each step down costs more
  // Expected output: condition scores 1 and 0.5 at or above the minimum, then 0.125 for fair and -0.25 for poor
  test('Soft Min Condition Penalty For Each Step', async () => {
    const brandNew = await makeListing(mongo.store, OTHER, { condition: 'new' });
    const good = await makeListing(mongo.store, OTHER, { condition: 'good' });
    const fair = await makeListing(mongo.store, OTHER, { condition: 'fair' });
    const poor = await makeListing(mongo.store, OTHER, { condition: 'poor' });

    const matches = await feedFor([soft('condition', 'good', 3)]);

    expect(ids(matches)).toEqual([brandNew.id, good.id, fair.id, poor.id]);
    expect(scoreOf(matches, brandNew.id)).toBeCloseTo(expectedScore({ condition: 1 }));
    expect(scoreOf(matches, good.id)).toBeCloseTo(expectedScore({ condition: 0.5 }));
    expect(scoreOf(matches, fair.id)).toBeCloseTo(expectedScore({ condition: 0.125 }));
    expect(scoreOf(matches, poor.id)).toBeCloseTo(expectedScore({ condition: -0.25 }));
  });

  // Input: my request with a hard maximum of $100 and a hard minimum of good, and listings over, under and within them
  // Expected status code: 200
  // Expected behavior: hard requirements still filter, and the listing that meets them gets no penalty
  // Expected output: only the listing that meets both, with price 0.5 and condition 0.5
  test('Hard Price And Condition Are Unchanged', async () => {
    const within = await makeListing(mongo.store, OTHER, { price: 50, condition: 'good' });
    await makeListing(mongo.store, OTHER, { price: 105, condition: 'good' });
    await makeListing(mongo.store, OTHER, { price: 50, condition: 'fair' });

    const matches = await feedFor([hard('price', 100), hard('condition', 'good')]);

    expect(ids(matches)).toEqual([within.id]);
    expect(scoreOf(matches, within.id)).toBeCloseTo(expectedScore({ price: 0.5, condition: 0.5 }));
  });

  // Input: my request preferring a brand at importance 5 and a colour at importance 1, and a listing meeting each
  // Expected status code: 200
  // Expected behavior: the higher-importance preference counts for more, even though the other listing is newer
  // Expected output: the brand listing first, with match 5/6 against 1/6
  test('Higher Importance Preference Ranks First', async () => {
    const brand = await makeListing(mongo.store, OTHER, { listingFields: [listingField('brand', 'ikea'), listingField('colour', 'red')] });
    const colour = await makeListing(mongo.store, OTHER, { listingFields: [listingField('brand', 'hay'), listingField('colour', 'oak')] });

    const matches = await feedFor([soft('brand', 'ikea', 5), soft('colour', 'oak', 1)]);

    expect(ids(matches)).toEqual([brand.id, colour.id]);
    expect(scoreOf(matches, brand.id)).toBeCloseTo(expectedScore({ match: 5 / 6 }));
    expect(scoreOf(matches, colour.id)).toBeCloseTo(expectedScore({ match: 1 / 6 }));
  });

  // Input: my request with three preferences at equal importance, a listing meeting two and a listing meeting one
  // Expected status code: 200
  // Expected behavior: equal importances give the same ranking as a plain average
  // Expected output: the listing meeting two first, with match 2/3 against 1/3
  test('Equal Importances Are A Plain Average', async () => {
    const two = await makeListing(mongo.store, OTHER, {
      listingFields: [listingField('brand', 'ikea'), listingField('colour', 'oak'), listingField('material', 'pine')],
    });
    const one = await makeListing(mongo.store, OTHER, {
      listingFields: [listingField('brand', 'ikea'), listingField('colour', 'red'), listingField('material', 'pine')],
    });

    const matches = await feedFor([soft('brand', 'ikea', 2), soft('colour', 'oak', 2), soft('material', 'teak', 2)]);

    expect(ids(matches)).toEqual([two.id, one.id]);
    expect(scoreOf(matches, two.id)).toBeCloseTo(expectedScore({ match: 2 / 3 }));
    expect(scoreOf(matches, one.id)).toBeCloseTo(expectedScore({ match: 1 / 3 }));
  });

  // Input: my request preferring a brand at importance 1 and a colour with no importance, and a listing meeting the colour
  // Expected status code: 200
  // Expected behavior: a preference with no importance counts as 3
  // Expected output: match 3/4
  test('Preference With No Importance Counts As 3', async () => {
    const listing = await makeListing(mongo.store, OTHER, { listingFields: [listingField('brand', 'hay'), listingField('colour', 'oak')] });

    const matches = await feedFor([soft('brand', 'ikea', 1), soft('colour', 'oak')]);

    expect(scoreOf(matches, listing.id)).toBeCloseTo(expectedScore({ match: 3 / 4 }));
  });

  // Input: my request preferring a brand at importance 5 and a colour at importance 1, and a listing that leaves the brand blank
  // Expected status code: 200
  // Expected behavior: the blank field scores 0.5 and still counts with its importance
  // Expected output: match (5 * 0.5 + 1 * 1) / 6
  test('Blank Field Keeps Its Importance', async () => {
    const listing = await makeListing(mongo.store, OTHER, { listingFields: [listingField('colour', 'oak')] });

    const matches = await feedFor([soft('brand', 'ikea', 5), soft('colour', 'oak', 1)]);

    expect(scoreOf(matches, listing.id)).toBeCloseTo(expectedScore({ match: 3.5 / 6 }));
  });
});
