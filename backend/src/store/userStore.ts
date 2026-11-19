import type { Collection, Db } from 'mongodb';
import type { GeoPoint } from '../models/common';
import { SESSIONS_COLLECTION, type RefreshSession } from '../models/session';
import { USERS_COLLECTION, type PublicUser, type SignInProfile, type User } from '../models/user';
import { sessionSchema, userSchema } from '../models/schema';
import type { SessionRepo, UserCollection } from './types';
import { applySchema, WITHOUT_ID } from './mongoHelpers';

// Users are keyed by their Google account id, so Mongo leaves _id out, as for options.
export class MongoUserCollection implements UserCollection {
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

export class MongoSessionRepo implements SessionRepo {
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

export async function setupUserCollections(db: Db): Promise<void> {
  await Promise.all([applySchema(db, USERS_COLLECTION, userSchema), applySchema(db, SESSIONS_COLLECTION, sessionSchema)]);
  await Promise.all([
    db.collection(USERS_COLLECTION).createIndex({ id: 1 }, { unique: true }),
    db.collection(SESSIONS_COLLECTION).createIndexes([
      { key: { tokenHash: 1 }, unique: true },
      { key: { familyId: 1 } },
      // MongoDB deletes each row once its refresh token has expired.
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    ]),
  ]);
}
