import { ObjectId, type ClientSession, type Collection, type Db, type Document } from 'mongodb';

export type Stored<T> = Omit<T, 'id'> & { _id: ObjectId };

export function toDoc<T extends { id: string }>(stored: Stored<T>): T {
  const { _id, ...rest } = stored;
  return { ...rest, id: _id.toHexString() } as unknown as T;
}

export function toDocs<T extends { id: string }>(found: unknown[]): T[] {
  return (found as Stored<T>[]).map((stored) => toDoc<T>(stored));
}

export type InSession = { session: ClientSession } | Record<string, never>;

export function inSession(session?: ClientSession): InSession {
  return session === undefined ? {} : { session };
}

export async function insertDoc<T extends { id: string }>(collection: Collection, doc: Omit<T, 'id'>, options: InSession = {}): Promise<T> {
  const _id = new ObjectId();
  await collection.insertOne({ ...doc, _id }, options);
  return { ...doc, id: _id.toHexString() } as T;
}

// Options and custom fields have no id of their own, so Mongo leaves _id out.
export const WITHOUT_ID = { projection: { _id: 0 } };

// Creates the collection with its validator, or updates the validator if it already exists.
export async function applySchema(db: Db, name: string, jsonSchema: Document): Promise<void> {
  const validator = { $jsonSchema: jsonSchema };
  const exists = (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
  if (exists) {
    await db.command({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' });
  } else {
    await db.createCollection(name, { validator });
  }
}
