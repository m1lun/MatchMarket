import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

import { BadRequestError } from '../errors';
import type { GeoPoint } from '../models/common';
import type { Message } from '../models/conversation';
import type { Listing } from '../models/listing';
import { currentUser } from '../sessions';
import type { Store } from '../store/types';
import { handle } from './handle';

// Test-only E2E setup routes, mounted only when ENABLE_E2E_ROUTES=true.

// Deals use the caller's own seed buyer, and conversations the caller's own seed partner, never another real user.

export const E2E_DEAL_PRICE = 45;
export const E2E_REQUEST_NAME = 'E2E desk';
export const E2E_LISTING_NAME = 'E2E lamp';
export const E2E_LISTING_PRICE = 30;
export const MAX_SEEDED_MESSAGES = 40;
// Listings must have a photo id; the seeded listing does not need a real file behind it.
const E2E_PHOTO_ID = '6ad40b88e74dd3678bfef8f3';

const LOCATION: GeoPoint = { type: 'Point', coordinates: [-123.25, 49.26] };

export function e2eBuyerId(userId: string): string {
  return `e2e-buyer-${userId}`;
}

export function e2ePartnerId(userId: string): string {
  return `e2e-partner-${userId}`;
}

// Runs the conversation routes as the caller's seed partner, so tests can reply, propose, accept and
// decline the way a second phone would, through the same code.
export function actAsE2ePartner(_req: Request, res: Response, next: NextFunction): void {
  const partner = e2ePartnerId(currentUser(res).id);
  res.locals.user = { id: partner, email: `${partner}@example.com` };
  next();
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

// Removes the caller's seed partner's listings and conversations, and any deal and rating made from them.
async function clearSeededConversations(store: Store, me: string): Promise<void> {
  const partner = e2ePartnerId(me);
  const [conversationIds, listings, deals] = await Promise.all([
    store.conversations.removeByUser(partner),
    store.listings.listByOwner(partner),
    store.deals.removeBySellerAndBuyer(partner, me),
  ]);
  await Promise.all([
    store.messages.removeByConversations(conversationIds),
    store.ratings.removeByDealIds(deals.map((deal) => deal.id)),
    store.reputations.remove(partner),
    ...listings.map((listing) => store.listings.remove(listing.id)),
  ]);
}

async function seedPartnerListing(store: Store, me: string): Promise<Listing> {
  const partner = e2ePartnerId(me);
  await clearSeededConversations(store, me);
  await store.users.upsertFromSignIn({ id: partner, firstName: 'E2E', lastName: 'Seller', email: `${partner}@example.com`, pictureUrl: null });
  const now = new Date();
  return store.listings.insert({
    ownerId: partner,
    name: E2E_LISTING_NAME,
    category: 'lamp',
    price: E2E_LISTING_PRICE,
    condition: 'good',
    description: 'Seeded for the E2E tests',
    address: '6335 Thunderbird Crescent, Vancouver',
    location: LOCATION,
    photoIds: [E2E_PHOTO_ID],
    listingFields: [],
    status: 'open',
    createdAt: now,
    updatedAt: now,
  });
}

function parseMessageCount(query: Request['query']): number {
  const { messages } = query;
  if (messages === undefined) {
    return 0;
  }
  const count = typeof messages === 'string' && /^\d+$/.test(messages) ? Number(messages) : Number.NaN;
  if (!(count <= MAX_SEEDED_MESSAGES)) {
    throw new BadRequestError([`messages must be a whole number from 0 to ${MAX_SEEDED_MESSAGES}`]);
  }
  return count;
}

// Messages are paged by id, so they are saved one at a time to keep "Message 1" the oldest.
async function seedPartnerMessages(store: Store, conversationId: string, senderId: string, count: number): Promise<void> {
  let last: Omit<Message, 'id' | 'conversationId'> | undefined;
  for (let number = 1; number <= count; number++) {
    last = { senderId, text: `Message ${number}`, createdAt: new Date() };
    await store.messages.insert({ conversationId, ...last });
  }
  if (last !== undefined) {
    await store.conversations.recordMessage(conversationId, last);
  }
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

  // POST /api/e2e/listings — replaces the seed partner's listing, which the caller can start a conversation about.
  router.post('/listings', handle(async (_req, res) => {
    const listing = await seedPartnerListing(store, currentUser(res).id);
    res.status(201).json({ listingId: listing.id });
  }));

  // POST /api/e2e/conversations?messages=<0-40> — the partner's listing and the caller's conversation about it,
  // with that many messages from the partner; returns { listingId, conversationId }.
  router.post('/conversations', handle(async (req, res) => {
    const count = parseMessageCount(req.query);
    const me = currentUser(res).id;
    const listing = await seedPartnerListing(store, me);
    const now = new Date();
    const { conversation } = await store.conversations.open({
      listingId: listing.id,
      requestId: null,
      sellerId: listing.ownerId,
      buyerId: me,
      postKind: 'listing',
      lastMessage: null,
      createdAt: now,
      updatedAt: now,
    });
    await seedPartnerMessages(store, conversation.id, listing.ownerId, count);
    res.status(201).json({ listingId: listing.id, conversationId: conversation.id });
  }));

  // DELETE /api/e2e/conversations — removes everything the two routes above seeded.
  router.delete('/conversations', handle(async (_req, res) => {
    await clearSeededConversations(store, currentUser(res).id);
    res.status(204).end();
  }));

  return router;
}
