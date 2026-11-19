import { ObjectId, type ClientSession, type Collection, type Db, type Document } from 'mongodb';
import { assertHasPost, DEALS_COLLECTION, type Deal } from '../models/deal';
import { RATINGS_COLLECTION, type Rating } from '../models/rating';
import { REPUTATIONS_COLLECTION, type Reputation } from '../models/reputation';
import { dealSchema, ratingSchema, reputationSchema } from '../models/schema';
import type { DealCollection, RatingCollection, RatingUpdate, ReputationCollection } from './types';
import { applySchema, toDoc, toDocs, inSession, insertDoc, WITHOUT_ID } from './mongoHelpers';
import type { Stored, InSession } from './mongoHelpers';

export class MongoDealCollection implements DealCollection {
  constructor(private readonly collection: Collection) {}

  async insert(doc: Omit<Deal, 'id'>): Promise<Deal> {
    assertHasPost(doc);
    return insertDoc<Deal>(this.collection, doc);
  }

  async findById(id: string): Promise<Deal | null> {
    if (!ObjectId.isValid(id)) {
      return null;
    }
    const found = await this.collection.findOne({ _id: new ObjectId(id) });
    return found === null ? null : toDoc<Deal>(found as Stored<Deal>);
  }

  async findByPosts(posts: Pick<Deal, 'listingId' | 'requestId'>): Promise<Deal | null> {
    assertHasPost(posts);
    // A null id would match every deal without that kind of post, so only the posts the caller has are matched.
    const matches: Document[] = [];
    if (posts.listingId !== null) {
      matches.push({ listingId: posts.listingId });
    }
    if (posts.requestId !== null) {
      matches.push({ requestId: posts.requestId });
    }
    const found = await this.collection.findOne({ $or: matches });
    return found === null ? null : toDoc<Deal>(found as Stored<Deal>);
  }

  async listByUser(userId: string, limit: number, before?: string): Promise<Deal[]> {
    const query: Document = { $or: [{ sellerId: userId }, { buyerId: userId }] };
    if (before !== undefined) {
      query._id = { $lt: new ObjectId(before) };
    }
    const found = await this.collection.find(query).sort({ _id: -1 }).limit(limit).toArray();
    return toDocs<Deal>(found as unknown[]);
  }

  async removeBySellerAndBuyer(sellerId: string, buyerId: string): Promise<Deal[]> {
    const found = toDocs<Deal>((await this.collection.find({ sellerId, buyerId }).toArray()) as unknown[]);
    await this.collection.deleteMany({ sellerId, buyerId });
    return found;
  }
}

export class MongoRatingCollection implements RatingCollection {
  private readonly tx: InSession;

  constructor(private readonly collection: Collection, session?: ClientSession) {
    this.tx = inSession(session);
  }

  insert(doc: Omit<Rating, 'id'>): Promise<Rating> {
    return insertDoc<Rating>(this.collection, doc, this.tx);
  }

  async update(dealId: string, raterId: string, stars: number, comment: string, now: Date): Promise<RatingUpdate | null> {
    const before = await this.collection.findOneAndUpdate(
      { dealId, raterId },
      { $set: { stars, comment, updatedAt: now } },
      { returnDocument: 'before', ...this.tx },
    );
    if (before === null) {
      return null;
    }
    const previous = toDoc<Rating>(before as Stored<Rating>);
    return { previousStars: previous.stars, rating: { ...previous, stars, comment, updatedAt: now } };
  }

  async listByDeals(dealIds: string[]): Promise<Rating[]> {
    if (dealIds.length === 0) {
      return [];
    }
    // Only what the deals list shows, not ratedUserId or updatedAt.
    const found = await this.collection
      .find(
        { dealId: { $in: dealIds } },
        { projection: { dealId: 1, raterId: 1, stars: 1, comment: 1, createdAt: 1 }, ...this.tx },
      )
      .toArray();
    return toDocs<Rating>(found as unknown[]);
  }

  async removeByDealIds(dealIds: string[]): Promise<void> {
    await this.collection.deleteMany({ dealId: { $in: dealIds } }, this.tx);
  }
}

export class MongoReputationCollection implements ReputationCollection {
  private readonly tx: InSession;

  constructor(private readonly collection: Collection, session?: ClientSession) {
    this.tx = inSession(session);
  }

  async find(userId: string): Promise<Reputation | null> {
    const found = await this.collection.findOne({ userId }, { ...WITHOUT_ID, ...this.tx });
    return found as Reputation | null;
  }

  async findMany(userIds: string[]): Promise<Reputation[]> {
    if (userIds.length === 0) {
      return [];
    }
    const found = await this.collection.find({ userId: { $in: userIds } }, { ...WITHOUT_ID, ...this.tx }).toArray();
    return found as unknown as Reputation[];
  }

  // A pipeline update reads and writes in one step, so two ratings at once both count.
  async addRating(userId: string, stars: number, now: Date): Promise<Reputation> {
    const updated = await this.collection.findOneAndUpdate(
      { userId },
      [
        {
          $set: {
            starSum: { $add: [{ $ifNull: ['$starSum', 0] }, stars] },
            ratingCount: { $add: [{ $ifNull: ['$ratingCount', 0] }, 1] },
            updatedAt: now,
          },
        },
      ],
      { upsert: true, returnDocument: 'after', ...WITHOUT_ID, ...this.tx },
    );
    return updated as unknown as Reputation;
  }

  async changeStars(userId: string, delta: number, now: Date): Promise<Reputation | null> {
    const updated = await this.collection.findOneAndUpdate(
      { userId },
      { $inc: { starSum: delta }, $set: { updatedAt: now } },
      { returnDocument: 'after', ...WITHOUT_ID, ...this.tx },
    );
    return updated as Reputation | null;
  }

  async remove(userId: string): Promise<void> {
    await this.collection.deleteOne({ userId }, this.tx);
  }
}

export async function setupDealCollections(db: Db): Promise<void> {
  await Promise.all([
    applySchema(db, DEALS_COLLECTION, dealSchema),
    applySchema(db, RATINGS_COLLECTION, ratingSchema),
    applySchema(db, REPUTATIONS_COLLECTION, reputationSchema),
  ]);
  await Promise.all([
    db.collection(DEALS_COLLECTION).createIndexes([
      { key: { sellerId: 1, _id: -1 } },
      { key: { buyerId: 1, _id: -1 } },
      // Partial, so deals without a listing or without a request don't collide on null.
      { key: { listingId: 1 }, unique: true, partialFilterExpression: { listingId: { $type: 'string' } } },
      { key: { requestId: 1 }, unique: true, partialFilterExpression: { requestId: { $type: 'string' } } },
    ]),
    db.collection(RATINGS_COLLECTION).createIndexes([
      { key: { dealId: 1, raterId: 1 }, unique: true },
      { key: { ratedUserId: 1 } },
    ]),
    db.collection(REPUTATIONS_COLLECTION).createIndex({ userId: 1 }, { unique: true }),
  ]);
}
