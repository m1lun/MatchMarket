import type { Deal } from '../models/deal';
import type { Rating } from '../models/rating';
import type { Reputation } from '../models/reputation';

export interface DealCollection {
  insert(doc: Omit<Deal, 'id'>): Promise<Deal>;
  findById(id: string): Promise<Deal | null>;
  findByPosts(posts: Pick<Deal, 'listingId' | 'requestId'>): Promise<Deal | null>;
  listByUser(userId: string, limit: number, before?: string): Promise<Deal[]>;
  removeBySellerAndBuyer(sellerId: string, buyerId: string): Promise<Deal[]>;
}

export interface RatingUpdate {
  previousStars: number;
  rating: Rating;
}

export interface RatingCollection {
  insert(doc: Omit<Rating, 'id'>): Promise<Rating>;
  update(dealId: string, raterId: string, stars: number, comment: string, now: Date): Promise<RatingUpdate | null>;
  listByDeals(dealIds: string[]): Promise<Rating[]>;
  removeByDealIds(dealIds: string[]): Promise<void>;
}

export interface ReputationCollection {
  find(userId: string): Promise<Reputation | null>;
  findMany(userIds: string[]): Promise<Reputation[]>;
  addRating(userId: string, stars: number, now: Date): Promise<Reputation>;
  changeStars(userId: string, delta: number, now: Date): Promise<Reputation | null>;
  remove(userId: string): Promise<void>;
}
