import { Router } from 'express';

import type { GeoPoint } from '../models/common';
import { currentUser } from '../sessions';
import type { Store } from '../store/types';
import { handle } from './handle';

// Test-only E2E setup routes, mounted only when ENABLE_E2E_ROUTES=true.

// Deals use the caller's own seed buyer, never another real user.

export const E2E_DEAL_PRICE = 45;
export const E2E_REQUEST_NAME = 'E2E desk';

const LOCATION: GeoPoint = { type: 'Point', coordinates: [-123.25, 49.26] };

export function e2eBuyerId(userId: string): string {
  return `e2e-buyer-${userId}`;
}

// Removes the caller's seeded deals and everything linked to them.
async function clearSeededDeals(store: Store, me: string): Promise<void> {
  const buyer = e2eBuyerId(me);
  const deals = await store.deals.removeBySellerAndBuyer(me, buyer);
  const requestIds = deals.map((deal) => deal.requestId).filter((id): id is string => id !== null);
  await Promise.all([
    store.ratings.removeByDealIds(deals.map((deal) => deal.id)),
    ...requestIds.map((id) => store.requests.remove(id)),
    store.reputations.remove(buyer),
  ]);
}

export function createE2eRouter(store: Store): Router {
  const router = Router();

  // POST /api/e2e/deals — replaces the caller's seeded deal; returns { dealId }.
  router.post('/deals', handle(async (_req, res) => {
    const me = currentUser(res).id;
    const buyer = e2eBuyerId(me);
    await clearSeededDeals(store, me);
    await store.users.upsertFromSignIn({
      id: buyer,
      firstName: 'E2E',
      lastName: 'Buyer',
      email: `${buyer}@example.com`,
      pictureUrl: null,
    });
    const now = new Date();
    const request = await store.requests.insert({
      ownerId: buyer,
      name: E2E_REQUEST_NAME,
      category: 'desk',
      description: 'Seeded for the E2E tests',
      address: '6335 Thunderbird Crescent, Vancouver',
      location: LOCATION,
      photoIds: [],
      requestFields: [{ key: 'price', label: 'Price', kind: 'builtin', type: 'number', value: 50, hard: true }],
      status: 'closed',
      createdAt: now,
      updatedAt: now,
    });
    const deal = await store.deals.insert({
      listingId: null,
      requestId: request.id,
      sellerId: me,
      buyerId: buyer,
      agreedPrice: E2E_DEAL_PRICE,
      createdAt: now,
    });
    res.status(201).json({ dealId: deal.id });
  }));

  // DELETE /api/e2e/deals — removes the caller's seeded deals.
  router.delete('/deals', handle(async (_req, res) => {
    await clearSeededDeals(store, currentUser(res).id);
    res.status(204).end();
  }));

  return router;
}
