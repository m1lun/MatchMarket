import { ObjectId, type Collection, type Db, type Document } from 'mongodb';
import { postIndexes } from '../../../shared/models/common';
import { CUSTOM_FIELDS_COLLECTION, type CustomField } from '../models/customField';
import { LISTINGS_COLLECTION } from '../models/listing';
import { OPTIONS_COLLECTION, type Option } from '../models/option';
import { REQUESTS_COLLECTION } from '../models/request';
import { customFieldSchema, listingSchema, optionSchema, requestSchema } from '../models/schema';
import type { CustomFieldCollection, OpenPostFilter, OptionCollection, PostDoc, PostCollection } from './types';
import { findOpen, findOpenInCategory } from '../../matching/store/matchingStore';
import { applySchema, toDoc, WITHOUT_ID } from '../../../shared/store/mongoHelpers';
import type { Stored } from '../../../shared/store/mongoHelpers';

// Posts saved before posts had names take their category as the name.
function toPostDoc<T extends PostDoc & { name: string; category: string }>(stored: Stored<T>): T {
  const doc = toDoc<T>(stored);
  return { ...doc, name: (doc.name as string | undefined) ?? doc.category };
}

export class MongoPostCollection<T extends PostDoc & { name: string; category: string }> implements PostCollection<T> {
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

  async listOpen(excludeOwnerId: string, limit: number, filter: OpenPostFilter = {}): Promise<T[]> {
    const stored = (await findOpen(this.collection, this.priceQuery, excludeOwnerId, limit, filter)) as Stored<T>[];
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

  async listOpenInCategory(category: string, excludeOwnerId: string): Promise<T[]> {
    const stored = (await findOpenInCategory(this.collection, category, excludeOwnerId)) as Stored<T>[];
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

  async close(id: string, updatedAt: Date): Promise<void> {
    await this.collection.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'closed', updatedAt } });
  }

  async remove(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: new ObjectId(id) });
  }
}

export class MongoOptionCollection implements OptionCollection {
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

export class MongoCustomFieldCollection implements CustomFieldCollection {
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

export async function setupPostCollections(db: Db): Promise<void> {
  await Promise.all([
    applySchema(db, LISTINGS_COLLECTION, listingSchema),
    applySchema(db, REQUESTS_COLLECTION, requestSchema),
    applySchema(db, OPTIONS_COLLECTION, optionSchema),
    applySchema(db, CUSTOM_FIELDS_COLLECTION, customFieldSchema),
  ]);
  await Promise.all([
    db.collection(LISTINGS_COLLECTION).createIndexes([...postIndexes]),
    db.collection(REQUESTS_COLLECTION).createIndexes([...postIndexes]),
    db.collection(OPTIONS_COLLECTION).createIndex({ field: 1, key: 1 }, { unique: true }),
    db.collection(CUSTOM_FIELDS_COLLECTION).createIndex({ ownerId: 1, key: 1 }, { unique: true }),
  ]);
}
