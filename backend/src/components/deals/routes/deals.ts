import { Router } from 'express';

import { BadRequestError } from '../../../shared/errors';
import { DEFAULT_DEALS_PAGE, MAX_DEALS_PAGE } from '../../../shared/models/common';
import { otherParty, roleOf, type Deal } from '../models/deal';
import type { Rating } from '../models/rating';
import type { Reputation } from '../models/reputation';
import type { PublicUser } from '../../users/models/user';
import { reputationSummary } from '../logic/score';
import { currentUser } from '../../users/routes/requireAuth';
import type { Store } from '../../../shared/store/types';
import { isObject } from '../../../shared/http/checks';
import { handle } from '../../../shared/http/handle';

const DEAL_ID = /^[0-9a-f]{24}$/;
const DEALS_PARAMS = ['limit', 'before'];

function parseLimit(value: unknown, errors: string[]): number {
  if (value === undefined) {
    return DEFAULT_DEALS_PAGE;
  }
  const limit = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 0;
  if (limit < 1 || limit > MAX_DEALS_PAGE) {
    errors.push(`limit must be a whole number from 1 to ${MAX_DEALS_PAGE}`);
  }
  return limit;
}

function parseBefore(value: unknown, errors: string[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !DEAL_ID.test(value)) {
    errors.push('before must be the nextCursor from a previous page');
    return undefined;
  }
  return value;
}

function byId<T extends { id?: string }>(items: T[]): Map<string, T> {
  return new Map(items.flatMap((item) => (item.id === undefined ? [] : [[item.id, item] as const])));
}

function present(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

function ratingView(rating: Rating | undefined): { stars: number; comment: string; createdAt: Date } | null {
  return rating === undefined ? null : { stars: rating.stars, comment: rating.comment, createdAt: rating.createdAt };
}

// The few fields of a listing or request the deals list reads.
interface PostView {
  id?: string;
  name?: string;
  category?: string;
  price?: number;
  photoIds?: string[];
}

// What the page of deals points at, looked up by id.
interface Lookups {
  ratingBy: Map<string, Rating>;
  reputationOf: Map<string, Reputation>;
  userOf: Map<string, PublicUser>;
  listingOf: Map<string, PostView>;
  requestOf: Map<string, PostView>;
}

function parseDealsQuery(query: unknown): { limit: number; before: string | undefined } {
  const params = isObject(query) ? query : {};
  const errors = Object.keys(params)
    .filter((name) => !DEALS_PARAMS.includes(name))
    .map((name) => `unsupported parameter "${name}"`);
  const limit = parseLimit(params.limit, errors);
  const before = parseBefore(params.before, errors);
  if (errors.length > 0) {
    throw new BadRequestError(errors);
  }
  return { limit, before };
}

function dealView(deal: Deal, me: string, lookups: Lookups) {
  const other = otherParty(deal, me);
  const user = lookups.userOf.get(other);
  const listing = deal.listingId === null ? undefined : lookups.listingOf.get(deal.listingId);
  const request = deal.requestId === null ? undefined : lookups.requestOf.get(deal.requestId);
  return {
    id: deal.id,
    role: roleOf(deal, me),
    agreedPrice: deal.agreedPrice,
    createdAt: deal.createdAt,
    title: listing?.name ?? request?.name ?? '',
    listing:
      listing === undefined
        ? null
        : { id: deal.listingId, category: listing.category, price: listing.price, photoId: listing.photoIds?.[0] ?? null },
    request:
      request === undefined ? null : { id: deal.requestId, category: request.category, photoId: request.photoIds?.[0] ?? null },
    // A user with no profile, e.g. one whose account was removed, has empty names.
    otherUser: {
      ...reputationSummary(other, lookups.reputationOf.get(other)),
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
    },
    myRating: ratingView(lookups.ratingBy.get(`${deal.id}:${me}`)),
    theirRating: ratingView(lookups.ratingBy.get(`${deal.id}:${other}`)),
  };
}

export function createDealsRouter(store: Store): Router {
  const router = Router();

  // GET /api/deals?limit=20&before=<nextCursor> — the caller's deals, newest first.
  // At most 6 queries however many deals there are; nextCursor is null on the last page.
  router.get('/', handle(async (req, res) => {
    const { limit, before } = parseDealsQuery(req.query);
    const me = currentUser(res).id;

    // One extra deal tells whether another page follows.
    const found = await store.deals.listByUser(me, limit + 1, before);
    const page = found.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = found.length > limit && last !== undefined ? last.id : null;

    const others = present(page.map((deal) => otherParty(deal, me)));
    const [ratings, reputations, users, listings, requests] = await Promise.all([
      store.ratings.listByDeals(page.map((deal) => deal.id)),
      store.reputations.findMany(others),
      store.users.findPublicByIds(others),
      store.listings.findByIds(present(page.map((deal) => deal.listingId)), ['name', 'category', 'price', 'photoIds'], true),
      store.requests.findByIds(present(page.map((deal) => deal.requestId)), ['name', 'category', 'photoIds'], true),
    ]);
    const lookups: Lookups = {
      ratingBy: new Map(ratings.map((rating) => [`${rating.dealId}:${rating.raterId}`, rating])),
      reputationOf: new Map(reputations.map((reputation) => [reputation.userId, reputation])),
      userOf: new Map(users.map((found) => [found.id, found])),
      listingOf: byId<PostView>(listings),
      requestOf: byId<PostView>(requests),
    };

    res.json({ deals: page.map((deal) => dealView(deal, me, lookups)), nextCursor });
  }));

  return router;
}
