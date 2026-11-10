import type { Server } from 'node:http';

import request from 'supertest';

import { E2E_DEAL_PRICE, E2E_REQUEST_NAME, e2eBuyerId } from '../../src/routes/e2e';
import { ME, OTHER, bearer, clearDealData, makeDeal, makeRating, makeRequest } from '../helpers/dealFixtures';
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

beforeEach(async () => {
  await clearDealData(mongo.db);
});

const BUYER = e2eBuyerId(ME);

function seed(userId = ME, server = app): request.Test {
  return request(server).post('/api/e2e/deals').set('Authorization', bearer(userId));
}

function clear(userId = ME, server = app): request.Test {
  return request(server).delete('/api/e2e/deals').set('Authorization', bearer(userId));
}

async function count(collection: string, filter: Record<string, unknown> = {}): Promise<number> {
  const found: number = await mongo.db.collection(collection).countDocuments(filter);
  return found;
}

// Interface POST /api/e2e/deals
describe('Unmocked: POST /api/e2e/deals', () => {
  // Input: POST /api/e2e/deals as ME, with no seeded deal yet
  // Expected status code: 201
  // Expected behavior: a seed buyer, their closed request and a deal in which ME sold to them are saved
  // Expected output: { dealId } of the new deal
  test('Seeds A Deal', async () => {
    const response = await seed();

    expect(response.status).toBe(201);
    const { dealId } = response.body as { dealId: string };
    const deal = await mongo.store.deals.findById(dealId);
    expect(deal).toMatchObject({ sellerId: ME, buyerId: BUYER, listingId: null, agreedPrice: E2E_DEAL_PRICE });
    const buyerRequest = await mongo.store.requests.findById(deal?.requestId ?? '');
    expect(buyerRequest).toMatchObject({ ownerId: BUYER, name: E2E_REQUEST_NAME, status: 'closed' });
    expect(await mongo.store.users.findById(BUYER)).toMatchObject({ firstName: 'E2E', lastName: 'Buyer' });
  });

  // Input: POST /api/e2e/deals twice as ME, after ME rated the first deal
  // Expected status code: 201
  // Expected behavior: the first deal, its rating, its request and the seed buyer's reputation are replaced
  // Expected output: { dealId } of the second deal, which is the only seeded deal left
  test('Seeding Again Starts Over', async () => {
    const first = (await seed()).body as { dealId: string };
    await request(app)
      .post(`/api/deals/${first.dealId}/ratings`)
      .set('Authorization', bearer(ME))
      .send({ stars: 4, comment: '' });

    const response = await seed();

    expect(response.status).toBe(201);
    expect(await count('deals')).toBe(1);
    expect(await count('requests')).toBe(1);
    expect(await count('ratings')).toBe(0);
    expect(await mongo.store.reputations.find(BUYER)).toBeNull();
  });

  // Input: POST /api/e2e/deals on a server started without ENABLE_E2E_ROUTES
  // Expected status code: 404
  // Expected behavior: the route does not exist, so nothing is saved
  // Expected output: { error: 'Not Found' }
  test('Off Without ENABLE_E2E_ROUTES: 404', async () => {
    const response = await seed(ME, appWithoutSeed);

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
    expect(await count('deals')).toBe(0);
  });

  // Input: POST /api/e2e/deals with no Authorization header
  // Expected status code: 401
  // Expected behavior: the request is rejected before anything is saved
  // Expected output: { error } naming the missing token
  test('No Token: 401', async () => {
    const response = await request(app).post('/api/e2e/deals');

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Missing Authorization: Bearer <session token> header' });
    expect(await count('deals')).toBe(0);
  });
});

// Interface DELETE /api/e2e/deals
describe('Unmocked: DELETE /api/e2e/deals', () => {
  // Input: DELETE /api/e2e/deals as ME, with a seeded deal ME rated, and a real deal between ME and OTHER
  // Expected status code: 204
  // Expected behavior: only the seeded deal, its rating, its request and the seed buyer's reputation are removed
  // Expected output: None
  test('Removes Only Seeded Deals', async () => {
    const { dealId } = (await seed()).body as { dealId: string };
    await request(app).post(`/api/deals/${dealId}/ratings`).set('Authorization', bearer(ME)).send({ stars: 5, comment: '' });
    const realRequest = await makeRequest(mongo.store, OTHER);
    const realDeal = await makeDeal(mongo.store, { sellerId: ME, buyerId: OTHER }, { requestId: realRequest.id });
    await makeRating(mongo.store, { dealId: realDeal.id, raterId: ME, ratedUserId: OTHER, stars: 3 });

    const response = await clear();

    expect(response.status).toBe(204);
    expect(await mongo.store.deals.findById(dealId)).toBeNull();
    expect(await mongo.store.deals.findById(realDeal.id)).toStrictEqual(realDeal);
    expect(await count('requests')).toBe(1);
    expect(await count('ratings', { dealId: realDeal.id })).toBe(1);
    expect(await count('ratings', { dealId })).toBe(0);
    expect(await mongo.store.reputations.find(BUYER)).toBeNull();
  });
});
