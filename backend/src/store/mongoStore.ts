import { MongoClient, ObjectId, type Collection, type Db, type Document, type MongoClientOptions } from 'mongodb';

import { createGridFsPhotoStorage } from '../photos/storage';
import { CUSTOM_FIELDS_COLLECTION, type CustomField } from '../models/customField';
import { postIndexes, type GeoPoint } from '../models/common';
import {
  CONVERSATIONS_COLLECTION,
  MESSAGES_COLLECTION,
  type Conversation,
  type LastMessage,
  type Message,
  type Proposal,
  type ProposalStatus,
} from '../models/conversation';
import { DEALS_COLLECTION, assertHasPost, type Deal } from '../models/deal';
import { normaliseListing, normaliseRequest } from '../models/normalise';
import { LISTINGS_COLLECTION, type Listing } from '../models/listing';
import { OPTIONS_COLLECTION, type Option } from '../models/option';
import { RATINGS_COLLECTION, type Rating } from '../models/rating';
import { REQUESTS_COLLECTION, type BuyerRequest } from '../models/request';
import { REPUTATIONS_COLLECTION, type Reputation } from '../models/reputation';
import { SESSIONS_COLLECTION, type RefreshSession } from '../models/session';
import { USERS_COLLECTION, type PublicUser, type SignInProfile, type User } from '../models/user';
import {
  conversationSchema,
  customFieldSchema,
  dealSchema,
  listingSchema,
  messageSchema,
  optionSchema,
  ratingSchema,
  reputationSchema,
  requestSchema,
  sessionSchema,
  userSchema,
} from '../models/schema';
import type {
  ConversationCollection,
  CustomFieldCollection,
  DealCollection,
  MessageCollection,
  OpenPostFilter,
  OptionCollection,
  PostDoc,
  PostCollection,
  RatingCollection,
  RatingUpdate,
  ReputationCollection,
  SessionRepo,
  Store,
  UserCollection,
} from './types';

type Stored<T> = Omit<T, 'id'> & { _id: ObjectId };

// The radius MongoDB uses for $centerSphere, which takes distances in radians.
const EARTH_RADIUS_KM = 6378.1;

function toDoc<T extends { id: string }>(stored: Stored<T>): T {
  const { _id, ...rest } = stored;
  return { ...rest, id: _id.toHexString() } as unknown as T;
}

function toDocs<T extends { id: string }>(found: unknown[]): T[] {
  return (found as Stored<T>[]).map((stored) => toDoc<T>(stored));
}

async function insertDoc<T extends { id: string }>(collection: Collection, doc: Omit<T, 'id'>): Promise<T> {
  const _id = new ObjectId();
  await collection.insertOne({ ...doc, _id });
  return { ...doc, id: _id.toHexString() } as T;
}

// Options and custom fields have no id of their own, so Mongo leaves _id out.
const WITHOUT_ID = { projection: { _id: 0 } };

// Posts saved before posts had names take their category as the name.
function toPostDoc<T extends PostDoc & { name: string; category: string }>(stored: Stored<T>): T {
  const doc = toDoc<T>(stored);
  return { ...doc, name: (doc.name as string | undefined) ?? doc.category };
}

class MongoPostCollection<T extends PostDoc & { name: string; category: string }> implements PostCollection<T> {
  constructor(
    private readonly collection: Collection,
    // Tidies a post (lower-case keys, trimmed text, no duplicate fields) before it is saved.
    private readonly normalise: (doc: Omit<T, 'id'>) => Omit<T, 'id'>,
    // Listings and requests store their price in different places.
    private readonly priceQuery: (range: Document) => Document,
  ) {}

  async insert(doc: Omit<T, 'id'>): Promise<T> {
    const clean = this.normalise(doc);
    const _id = new ObjectId();
    await this.collection.insertOne({ ...clean, _id });
    return { ...clean, id: _id.toHexString() } as T;
  }

  async findById(id: string): Promise<T | null> {
    if (!ObjectId.isValid(id)) {
      return null;
    }
    const found = await this.collection.findOne({ _id: new ObjectId(id) });
    return found === null ? null : toPostDoc<T>(found as Stored<T>);
  }

  async listByOwner(ownerId: string): Promise<T[]> {
    const found = await this.collection.find({ ownerId }).sort({ createdAt: -1 }).toArray();
    const stored = found as Stored<T>[];
    return stored.map((d) => toPostDoc<T>(d));
  }

  // Sorted by _id, which grows with insertion time and is unique, so pages never overlap.
  async listOpen(excludeOwnerId: string, limit: number, filter: OpenPostFilter = {}): Promise<T[]> {
    const query: Document = { status: 'open', ownerId: { $ne: excludeOwnerId } };
    if (filter.before !== undefined) {
      query._id = { $lt: new ObjectId(filter.before) };
    }
    if (filter.category !== undefined) {
      query.category = filter.category;
    }
    if (filter.minPrice !== undefined || filter.maxPrice !== undefined) {
      Object.assign(query, this.priceQuery({
        ...(filter.minPrice === undefined ? {} : { $gte: filter.minPrice }),
        ...(filter.maxPrice === undefined ? {} : { $lte: filter.maxPrice }),
      }));
    }
    if (filter.near !== undefined) {
      // $centerSphere rather than $near, so results keep the newest-first order.
      const { lat, lng, radiusKm } = filter.near;
      query.location = { $geoWithin: { $centerSphere: [[lng, lat], radiusKm / EARTH_RADIUS_KM] } };
    }
    const found = await this.collection.find(query).sort({ _id: -1 }).limit(limit).toArray();
    const stored = found as Stored<T>[];
    return stored.map((d) => toPostDoc<T>(d));
  }

  async listCategories(): Promise<string[]> {
    const categories: unknown = await this.collection.distinct('category');
    return categories as string[];
  }

  // Bypasses the validator because posts saved under older rules, such as before posts
  // had names, would fail it even though only their category is changing.
  async renameCategory(from: string, to: string): Promise<void> {
    await this.collection.updateMany({ category: from }, { $set: { category: to } }, { bypassDocumentValidation: true });
  }

  // Uses the { status, category } index.
  async listOpenInCategory(category: string, excludeOwnerId: string): Promise<T[]> {
    const found = await this.collection.find({ status: 'open', category, ownerId: { $ne: excludeOwnerId } }).toArray();
    const stored = found as Stored<T>[];
    return stored.map((d) => toPostDoc<T>(d));
  }

  async findByIds(ids: string[], fields: (keyof T)[], firstPhotoOnly = false): Promise<Partial<T>[]> {
    const objectIds: ObjectId[] = [];
    for (const id of ids) {
      if (ObjectId.isValid(id)) {
        objectIds.push(new ObjectId(id));
      }
    }
    if (objectIds.length === 0) {
      return [];
    }
    const projection = Object.fromEntries(
      fields.map((field) => [field, firstPhotoOnly && field === 'photoIds' ? { $slice: 1 } : 1])
    );
    const found = await this.collection.find({ _id: { $in: objectIds } }, { projection }).toArray();
    const stored = found as Stored<T>[];
    return stored.map((d) => toDoc<T>(d));
  }

  async replace(doc: T): Promise<T> {
    const { id, ...rest } = doc;
    const clean = this.normalise(rest);
    await this.collection.replaceOne({ _id: new ObjectId(id) }, clean);
    return { ...clean, id } as T;
  }

  async remove(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: new ObjectId(id) });
  }
}

class MongoOptionCollection implements OptionCollection {
  constructor(private readonly collection: Collection) {}

  async list(field: string): Promise<Option[]> {
    const found = await this.collection.find({ field }, WITHOUT_ID).sort({ label: 1 }).toArray();
    return found as unknown as Option[];
  }

  async ensure(option: Option): Promise<Option> {
    const stored = await this.collection.findOneAndUpdate(
      { field: option.field, key: option.key },
      { $setOnInsert: option },
      { upsert: true, returnDocument: 'after', ...WITHOUT_ID },
    );
    return (stored as Option | null) ?? option;
  }

  async ensureMany(options: Option[]): Promise<void> {
    if (options.length === 0) {
      return;
    }
    await this.collection.bulkWrite(
      options.map((option) => ({
        updateOne: {
          filter: { field: option.field, key: option.key },
          update: { $setOnInsert: option },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  async remove(field: string, key: string): Promise<void> {
    await this.collection.deleteOne({ field, key });
  }
}

class MongoCustomFieldCollection implements CustomFieldCollection {
  constructor(private readonly collection: Collection) {}

  async list(ownerId: string): Promise<CustomField[]> {
    const found = await this.collection.find({ ownerId }, WITHOUT_ID).toArray();
    return found as unknown as CustomField[];
  }

  async upsert(def: CustomField): Promise<CustomField> {
    await this.collection.updateOne(
      { ownerId: def.ownerId, key: def.key },
      { $set: def },
      { upsert: true },
    );
    return def;
  }

  async remove(ownerId: string, key: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ ownerId, key });
    return result.deletedCount === 1;
  }
}

// Users are keyed by their Google account id, so Mongo leaves _id out, as for options.
class MongoUserCollection implements UserCollection {
  constructor(private readonly collection: Collection) {}

  async upsertFromSignIn({ id, firstName, lastName, email, pictureUrl }: SignInProfile): Promise<void> {
    const now = new Date();
    // A field can't be in both $set and $setOnInsert, so a missing photo only
    // starts out as null instead of overwriting the stored one.
    const refreshed = pictureUrl === undefined ? { email } : { email, pictureUrl };
    const initial = pictureUrl === undefined ? { firstName, lastName, pictureUrl: null } : { firstName, lastName };
    await this.collection.updateOne(
      { id },
      { $set: { ...refreshed, updatedAt: now }, $setOnInsert: { ...initial, createdAt: now } },
      { upsert: true },
    );
  }

  async findById(id: string): Promise<User | null> {
    const found = await this.collection.findOne({ id }, WITHOUT_ID);
    return found as User | null;
  }

  async findPublicByIds(ids: string[]): Promise<PublicUser[]> {
    if (ids.length === 0) {
      return [];
    }
    const found = await this.collection
      .find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, firstName: 1, lastName: 1, pictureUrl: 1 } })
      .toArray();
    return found as unknown as PublicUser[];
  }

  async updateAddress(id: string, place: { address: string; location: GeoPoint } | null): Promise<User | null> {
    const updatedAt = new Date();
    const update =
      place === null ? { $unset: { address: '', location: '' }, $set: { updatedAt } } : { $set: { ...place, updatedAt } };
    const found = await this.collection.findOneAndUpdate({ id }, update, { returnDocument: 'after', ...WITHOUT_ID });
    return found as User | null;
  }
}

class MongoDealCollection implements DealCollection {
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

class MongoRatingCollection implements RatingCollection {
  constructor(private readonly collection: Collection) {}

  insert(doc: Omit<Rating, 'id'>): Promise<Rating> {
    return insertDoc<Rating>(this.collection, doc);
  }

  async update(dealId: string, raterId: string, stars: number, comment: string, now: Date): Promise<RatingUpdate | null> {
    const before = await this.collection.findOneAndUpdate(
      { dealId, raterId },
      { $set: { stars, comment, updatedAt: now } },
      { returnDocument: 'before' },
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
      .find({ dealId: { $in: dealIds } }, { projection: { dealId: 1, raterId: 1, stars: 1, comment: 1, createdAt: 1 } })
      .toArray();
    return toDocs<Rating>(found as unknown[]);
  }

  async removeByDealIds(dealIds: string[]): Promise<void> {
    await this.collection.deleteMany({ dealId: { $in: dealIds } });
  }
}

class MongoReputationCollection implements ReputationCollection {
  constructor(private readonly collection: Collection) {}

  async find(userId: string): Promise<Reputation | null> {
    const found = await this.collection.findOne({ userId }, WITHOUT_ID);
    return found as Reputation | null;
  }

  async findMany(userIds: string[]): Promise<Reputation[]> {
    if (userIds.length === 0) {
      return [];
    }
    const found = await this.collection.find({ userId: { $in: userIds } }, WITHOUT_ID).toArray();
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
      { upsert: true, returnDocument: 'after', ...WITHOUT_ID },
    );
    return updated as unknown as Reputation;
  }

  async changeStars(userId: string, delta: number, now: Date): Promise<Reputation | null> {
    const updated = await this.collection.findOneAndUpdate(
      { userId },
      { $inc: { starSum: delta }, $set: { updatedAt: now } },
      { returnDocument: 'after', ...WITHOUT_ID },
    );
    return updated as Reputation | null;
  }

  async remove(userId: string): Promise<void> {
    await this.collection.deleteOne({ userId });
  }
}

class MongoConversationCollection implements ConversationCollection {
  constructor(private readonly collection: Collection) {}

  // One upsert, so two taps on "Message" can't start two conversations. The filter has no postKind,
  // so the same two people reuse a conversation they already have about these posts.
  async open(doc: Omit<Conversation, 'id'>): Promise<{ conversation: Conversation; created: boolean }> {
    const sameItem = doc.postKind === 'listing'
      ? { listingId: doc.listingId, buyerId: doc.buyerId }
      : { requestId: doc.requestId, sellerId: doc.sellerId };
    const result = await this.collection.findOneAndUpdate(
      sameItem,
      { $setOnInsert: doc },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    // An upsert that returns the document after it always finds one.
    return {
      conversation: toDoc<Conversation>(result.value as Stored<Conversation>),
      created: result.lastErrorObject?.updatedExisting !== true,
    };
  }

  async findById(id: string): Promise<Conversation | null> {
    if (!ObjectId.isValid(id)) {
      return null;
    }
    const found = await this.collection.findOne({ _id: new ObjectId(id) });
    return found === null ? null : toDoc<Conversation>(found as Stored<Conversation>);
  }

  async listByUser(userId: string): Promise<Conversation[]> {
    const found = await this.collection
      .find({ $or: [{ sellerId: userId }, { buyerId: userId }] })
      .sort({ updatedAt: -1, _id: -1 })
      .toArray();
    return toDocs<Conversation>(found as unknown[]);
  }

  async recordMessage(id: string, message: LastMessage): Promise<void> {
    await this.collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { lastMessage: message, updatedAt: message.createdAt } },
    );
  }

  // The check is in the filter, so two proposals sent at once can't both be saved.
  async propose(id: string, proposal: Proposal): Promise<boolean> {
    const result = await this.collection.updateOne(
      { _id: new ObjectId(id), 'proposal.status': { $nin: ['pending', 'accepted'] } },
      { $set: { proposal, updatedAt: proposal.createdAt } },
    );
    return result.matchedCount === 1;
  }

  async setProposalStatus(id: string, status: ProposalStatus): Promise<void> {
    await this.collection.updateOne({ _id: new ObjectId(id) }, { $set: { 'proposal.status': status, updatedAt: new Date() } });
  }
}

class MongoMessageCollection implements MessageCollection {
  constructor(private readonly collection: Collection) {}

  insert(doc: Omit<Message, 'id'>): Promise<Message> {
    return insertDoc<Message>(this.collection, doc);
  }

  async listByConversation(conversationId: string, limit: number, before?: string): Promise<Message[]> {
    const query: Document = { conversationId };
    if (before !== undefined) {
      query._id = { $lt: new ObjectId(before) };
    }
    const found = await this.collection.find(query).sort({ _id: -1 }).limit(limit).toArray();
    return toDocs<Message>(found as unknown[]);
  }
}

class MongoSessionRepo implements SessionRepo {
  constructor(private readonly collection: Collection) {}

  async insert(session: RefreshSession): Promise<void> {
    await this.collection.insertOne({ ...session });
  }

  async consume(tokenHash: string, now: Date): Promise<RefreshSession | null> {
    const found = await this.collection.findOneAndUpdate(
      { tokenHash, usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
      { returnDocument: 'after', ...WITHOUT_ID },
    );
    return found as RefreshSession | null;
  }

  async find(tokenHash: string): Promise<RefreshSession | null> {
    const found = await this.collection.findOne({ tokenHash }, WITHOUT_ID);
    return found as RefreshSession | null;
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.collection.deleteMany({ familyId });
  }
}

// Creates the collection with its validator, or updates the validator if it already exists.
async function applySchema(db: Db, name: string, jsonSchema: Document): Promise<void> {
  const validator = { $jsonSchema: jsonSchema };
  const exists = (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
  if (exists) {
    await db.command({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' });
  } else {
    await db.createCollection(name, { validator });
  }
}

async function setupCollections(db: Db): Promise<void> {
  await Promise.all([
    applySchema(db, LISTINGS_COLLECTION, listingSchema),
    applySchema(db, REQUESTS_COLLECTION, requestSchema),
    applySchema(db, OPTIONS_COLLECTION, optionSchema),
    applySchema(db, CUSTOM_FIELDS_COLLECTION, customFieldSchema),
    applySchema(db, USERS_COLLECTION, userSchema),
    applySchema(db, SESSIONS_COLLECTION, sessionSchema),
    applySchema(db, DEALS_COLLECTION, dealSchema),
    applySchema(db, RATINGS_COLLECTION, ratingSchema),
    applySchema(db, REPUTATIONS_COLLECTION, reputationSchema),
    applySchema(db, CONVERSATIONS_COLLECTION, conversationSchema),
    applySchema(db, MESSAGES_COLLECTION, messageSchema),
  ]);
  await Promise.all([
    db.collection(LISTINGS_COLLECTION).createIndexes([...postIndexes]),
    db.collection(REQUESTS_COLLECTION).createIndexes([...postIndexes]),
    db.collection(OPTIONS_COLLECTION).createIndex({ field: 1, key: 1 }, { unique: true }),
    db.collection(CUSTOM_FIELDS_COLLECTION).createIndex({ ownerId: 1, key: 1 }, { unique: true }),
    db.collection(USERS_COLLECTION).createIndex({ id: 1 }, { unique: true }),
    db.collection(SESSIONS_COLLECTION).createIndexes([
      { key: { tokenHash: 1 }, unique: true },
      { key: { familyId: 1 } },
      // MongoDB deletes each row once its refresh token has expired.
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    ]),
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
    db.collection(CONVERSATIONS_COLLECTION).createIndexes([
      { key: { listingId: 1, buyerId: 1 }, unique: true, partialFilterExpression: { postKind: 'listing' } },
      { key: { requestId: 1, sellerId: 1 }, unique: true, partialFilterExpression: { postKind: 'request' } },
      { key: { sellerId: 1, updatedAt: -1 } },
      { key: { buyerId: 1, updatedAt: -1 } },
    ]),
    db.collection(MESSAGES_COLLECTION).createIndex({ conversationId: 1, _id: -1 }),
  ]);
}

export async function createMongoStore(uri: string, dbName: string, options?: MongoClientOptions): Promise<Store> {
  const client = new MongoClient(uri, options);
  await client.connect();
  const db = client.db(dbName);
  await setupCollections(db);
  return {
    listings: new MongoPostCollection<Listing>(db.collection(LISTINGS_COLLECTION), normaliseListing, (range) => ({
      price: range,
    })),
    requests: new MongoPostCollection<BuyerRequest>(db.collection(REQUESTS_COLLECTION), normaliseRequest, (range) => ({
      requestFields: { $elemMatch: { key: 'price', value: range } },
    })),
    options: new MongoOptionCollection(db.collection(OPTIONS_COLLECTION)),
    customFields: new MongoCustomFieldCollection(db.collection(CUSTOM_FIELDS_COLLECTION)),
    users: new MongoUserCollection(db.collection(USERS_COLLECTION)),
    sessions: new MongoSessionRepo(db.collection(SESSIONS_COLLECTION)),
    deals: new MongoDealCollection(db.collection(DEALS_COLLECTION)),
    ratings: new MongoRatingCollection(db.collection(RATINGS_COLLECTION)),
    reputations: new MongoReputationCollection(db.collection(REPUTATIONS_COLLECTION)),
    conversations: new MongoConversationCollection(db.collection(CONVERSATIONS_COLLECTION)),
    messages: new MongoMessageCollection(db.collection(MESSAGES_COLLECTION)),
    photos: createGridFsPhotoStorage(db),
    close: async () => {
      await client.close();
    },
  };
}
