import jwt from 'jsonwebtoken';
import type { Db } from 'mongodb';

import type { Conversation } from '../../src/models/conversation';
import type { Deal } from '../../src/models/deal';
import type { Listing } from '../../src/models/listing';
import type { Rating } from '../../src/models/rating';
import type { BuyerRequest } from '../../src/models/request';
import type { Store } from '../../src/store/types';

export const ME = 'user-me';
export const OTHER = 'user-other';
export const STRANGER = 'user-stranger';

export function bearer(userId: string): string {
  const token = jwt.sign({ email: `${userId}@example.com` }, process.env.JWT_SECRET ?? '', {
    subject: userId,
    issuer: 'matchmarket-backend',
    audience: 'matchmarket-app',
    expiresIn: 60,
  });
  return `Bearer ${token}`;
}

export const PHOTO_ID = '6ad40b88e74dd3678bfef8f3';

const LOCATION: Listing['location'] = { type: 'Point', coordinates: [-123.25, 49.26] };

export function makeListing(store: Store, ownerId: string, overrides: Partial<Listing> = {}): Promise<Listing> {
  const now = new Date();
  return store.listings.insert({
    ownerId,
    name: 'Chair',
    category: 'chair',
    price: 40,
    condition: 'good',
    description: 'A sturdy chair',
    address: '6335 Thunderbird Crescent, Vancouver',
    location: LOCATION,
    photoIds: [PHOTO_ID],
    listingFields: [],
    status: 'open',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

export function makeRequest(store: Store, ownerId: string, overrides: Partial<BuyerRequest> = {}): Promise<BuyerRequest> {
  const now = new Date();
  return store.requests.insert({
    ownerId,
    name: 'Chair',
    category: 'chair',
    description: 'Looking for a chair',
    address: '6335 Thunderbird Crescent, Vancouver',
    location: LOCATION,
    photoIds: [],
    requestFields: [{ key: 'price', label: 'Price', kind: 'builtin', type: 'number', value: 50, hard: true }],
    status: 'open',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

export function makeDeal(
  store: Store,
  parties: { sellerId: string; buyerId: string },
  posts: { listingId?: string | undefined; requestId?: string | undefined },
  overrides: Partial<Deal> = {}
): Promise<Deal> {
  return store.deals.insert({
    listingId: posts.listingId ?? null,
    requestId: posts.requestId ?? null,
    sellerId: parties.sellerId,
    buyerId: parties.buyerId,
    agreedPrice: 40,
    createdAt: new Date(),
    ...overrides,
  });
}

export function makeRating(
  store: Store,
  rating: Pick<Rating, 'dealId' | 'raterId' | 'ratedUserId' | 'stars'> & Partial<Rating>
): Promise<Rating> {
  return store.ratings.insert({ comment: '', createdAt: new Date(), ...rating });
}

// ME's listing and OTHER's request, in a conversation with OTHER's pending $45 proposal.
export async function makePendingProposal(store: Store): Promise<Conversation> {
  const now = new Date();
  const listing = await makeListing(store, ME);
  const buyerRequest = await makeRequest(store, OTHER);
  const { conversation } = await store.conversations.open({
    listingId: listing.id,
    requestId: buyerRequest.id,
    sellerId: ME,
    buyerId: OTHER,
    postKind: 'listing',
    lastMessage: null,
    createdAt: now,
    updatedAt: now,
  });
  await store.conversations.propose(conversation.id, { proposerId: OTHER, price: 45, note: '', status: 'pending', createdAt: now });
  return conversation;
}

// A user as first sign-in saves them, so their name can be shown on deals.
export function makeUser(store: Store, id: string, firstName: string, lastName: string): Promise<void> {
  return store.users.upsertFromSignIn({ id, firstName, lastName, email: `${id}@example.com`, pictureUrl: null });
}

export function makeReputation(store: Store, userId: string, stars: number[]): Promise<void> {
  return stars.reduce(
    (done, count) => done.then(() => store.reputations.addRating(userId, count, new Date()).then(() => undefined)),
    Promise.resolve()
  );
}

const DEAL_COLLECTIONS = ['deals', 'ratings', 'reputations', 'listings', 'requests', 'users'];

export async function clearDealData(db: Db): Promise<void> {
  await Promise.all(
    DEAL_COLLECTIONS.map(async (name) => {
      await db.collection(name).deleteMany({});
    })
  );
}

export interface StoredRating {
  dealId: string;
  raterId: string;
  ratedUserId: string;
  stars: number;
  comment: string;
  createdAt: Date;
  updatedAt?: Date;
}

export async function storedRatings(db: Db): Promise<StoredRating[]> {
  const found = (await db.collection('ratings').find().sort({ _id: 1 }).toArray()) as unknown[];
  return found as StoredRating[];
}
