import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { isObject } from '../../../shared/http/checks';
import { MAX_COMMENT_LENGTH, MAX_STARS, MIN_STARS } from '../../../shared/models/common';
import type { TransactionStore } from '../../../shared/store/types';
import type { PostsService } from '../../posts/services/postsService';
import type { PublicUser } from '../../users/models/user';
import type { UsersService } from '../../users/services/usersService';
import { otherParty, roleOf, type Deal } from '../models/deal';
import type { Rating } from '../models/rating';
import type { Reputation } from '../models/reputation';
import type { DealCollection, RatingCollection, ReputationCollection } from '../store/types';
import { reputationSummary } from './score';

// MongoDB's code for an insert that breaks a unique index.
const DUPLICATE_KEY = 11000;

class AlreadyRatedError extends Error {}

const RATING_FIELDS = ['stars', 'comment'];

function parseRating(body: unknown): { stars: number; comment: string } {
  const errors: string[] = [];
  const fields = isObject(body) ? body : {};
  if (!isObject(body)) {
    errors.push('Request body must be a JSON object');
  }
  for (const name of Object.keys(fields)) {
    if (!RATING_FIELDS.includes(name)) {
      errors.push(`unsupported field "${name}"`);
    }
  }
  const { stars } = fields;
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < MIN_STARS || stars > MAX_STARS) {
    errors.push(`stars must be a whole number from ${MIN_STARS} to ${MAX_STARS}`);
  }
  let comment = '';
  if (fields.comment !== undefined) {
    if (typeof fields.comment === 'string' && fields.comment.trim().length <= MAX_COMMENT_LENGTH) {
      comment = fields.comment.trim();
    } else {
      errors.push(`comment must be text of at most ${MAX_COMMENT_LENGTH} characters`);
    }
  }
  if (errors.length > 0 || typeof stars !== 'number') {
    throw new BadRequestError(errors);
  }
  return { stars, comment };
}

export interface DealsStore {
  deals: DealCollection;
  ratings: RatingCollection;
  reputations: ReputationCollection;
  transaction<T>(work: (tx: TransactionStore) => Promise<T>): Promise<T>;
}

export type DealTerms = Omit<Deal, 'id' | 'createdAt'>;

export interface RatingResult {
  rating: Rating;
  otherUser: { id: string; score: number | null; ratingCount: number };
}

// The few fields of a listing or request the deals list reads.
interface PostView {
  id: string;
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

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function firstPhotoId(post: PostView): string | null {
  return post.photoIds?.[0] ?? null;
}

function present(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

function ratingView(rating: Rating | undefined): { stars: number; comment: string; createdAt: Date } | null {
  return rating === undefined ? null : { stars: rating.stars, comment: rating.comment, createdAt: rating.createdAt };
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
        : { id: deal.listingId, category: listing.category, price: listing.price, photoId: firstPhotoId(listing) },
    request:
      request === undefined ? null : { id: deal.requestId, category: request.category, photoId: firstPhotoId(request) },
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

export class DealsService {
  constructor(
    private readonly store: DealsStore,
    private readonly posts: PostsService,
    private readonly users: UsersService,
  ) {}

  async listMine(me: string, limit: number, before: string | undefined) {
    // One extra deal tells whether another page follows.
    const found = await this.store.deals.listByUser(me, limit + 1, before);
    const page = found.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = found.length > limit && last !== undefined ? last.id : null;

    const others = present(page.map((deal) => otherParty(deal, me)));
    const [ratings, reputations, users, listings, requests] = await Promise.all([
      this.store.ratings.listByDeals(page.map((deal) => deal.id)),
      this.store.reputations.findMany(others),
      this.users.findPublicByIds(others),
      this.posts.findByIds('listing', present(page.map((deal) => deal.listingId)), ['name', 'category', 'price', 'photoIds'], true),
      this.posts.findByIds('request', present(page.map((deal) => deal.requestId)), ['name', 'category', 'photoIds'], true),
    ]);
    const lookups: Lookups = {
      ratingBy: new Map(ratings.map((rating) => [`${rating.dealId}:${rating.raterId}`, rating])),
      reputationOf: new Map(reputations.map((reputation) => [reputation.userId, reputation])),
      userOf: new Map(users.map((user) => [user.id, user])),
      listingOf: byId<PostView>(listings),
      requestOf: byId<PostView>(requests),
    };

    return { deals: page.map((deal) => dealView(deal, me, lookups)), nextCursor };
  }

  async rate(id: string, me: string, body: unknown): Promise<RatingResult> {
    const { stars, comment } = parseRating(body);
    const { dealId, ratedUserId } = await this.findMyDeal(id, me);
    const now = new Date();
    let saved: { rating: Rating; reputation: Reputation };
    try {
      saved = await this.store.transaction(async (tx) => {
        let rating: Rating;
        try {
          rating = await tx.ratings.insert({ dealId, raterId: me, ratedUserId, stars, comment, createdAt: now });
        } catch (error) {
          throw (error as { code?: number }).code === DUPLICATE_KEY ? new AlreadyRatedError() : error;
        }
        const reputation = await tx.reputations.addRating(ratedUserId, stars, now);
        return { rating, reputation };
      });
    } catch (error) {
      if (error instanceof AlreadyRatedError) {
        throw new ConflictError('You already rated this deal');
      }
      throw error;
    }
    return { rating: saved.rating, otherUser: reputationSummary(ratedUserId, saved.reputation) };
  }

  async editRating(id: string, me: string, body: unknown): Promise<RatingResult> {
    const { stars, comment } = parseRating(body);
    const { dealId, ratedUserId } = await this.findMyDeal(id, me);
    const now = new Date();
    const saved = await this.store.transaction(async (tx) => {
      const updated = await tx.ratings.update(dealId, me, stars, comment, now);
      if (updated === null) {
        return null;
      }
      const delta = stars - updated.previousStars;
      const reputation = delta === 0 ? await tx.reputations.find(ratedUserId) : await tx.reputations.changeStars(ratedUserId, delta, now);
      return { rating: updated.rating, reputation };
    });
    if (saved === null) {
      throw new NotFoundError('You have not rated this deal');
    }
    return { rating: saved.rating, otherUser: reputationSummary(ratedUserId, saved.reputation) };
  }

  async reputation(userId: string): Promise<{ userId: string; score: number | null; ratingCount: number }> {
    const { id, score, ratingCount } = reputationSummary(userId, await this.store.reputations.find(userId));
    return { userId: id, score, ratingCount };
  }

  findByPosts(posts: Pick<Deal, 'listingId' | 'requestId'>): Promise<Deal | null> {
    return this.store.deals.findByPosts(posts);
  }

  // Null if one of the posts got a deal since the check before it (deals are unique per post).
  async recordDeal(terms: DealTerms, now: Date): Promise<Deal | null> {
    try {
      return await this.store.deals.insert({ ...terms, createdAt: now });
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) {
        return null;
      }
      throw error;
    }
  }

  // A deal already on these posts is either this proposal's, recorded by an earlier accept that failed
  // before closing the posts, which this accept finishes, or another sale, which makes the posts unavailable.
  earlierDeal(deal: Deal, terms: DealTerms): Deal | null {
    const same =
      deal.listingId === terms.listingId &&
      deal.requestId === terms.requestId &&
      deal.sellerId === terms.sellerId &&
      deal.buyerId === terms.buyerId &&
      deal.agreedPrice === terms.agreedPrice;
    return same ? deal : null;
  }

  // The caller's deal and the other party in it.
  private async findMyDeal(id: string, me: string): Promise<{ dealId: string; ratedUserId: string }> {
    const deal = await this.store.deals.findById(id);
    if (deal === null) {
      throw new NotFoundError();
    }
    if (deal.sellerId !== me && deal.buyerId !== me) {
      throw new ForbiddenError();
    }
    return { dealId: deal.id, ratedUserId: otherParty(deal, me) };
  }
}
