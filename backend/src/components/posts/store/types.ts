import type { GeoPoint } from '../../../shared/models/common';
import type { CustomField } from '../models/customField';
import type { Option } from '../models/option';

export interface PostDoc {
  id: string;
  ownerId: string;
  category: string;
  status: 'open' | 'closed';
  location: GeoPoint;
  updatedAt: Date;
}

// A post's price is a listing's price or a request's budget.
export interface PostFilter {
  category?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  near?: { lat: number; lng: number; radiusKm: number } | undefined;
}

export interface OpenPostFilter extends PostFilter {
  before?: string | undefined;
}

// Posts (listings or requests) are stored without an id; the store assigns one.
export interface PostCollection<T extends PostDoc> {
  insert(doc: Omit<T, 'id'>): Promise<T>;
  findById(id: string): Promise<T | null>;
  listByOwner(ownerId: string): Promise<T[]>;
  replace(doc: T): Promise<T>;
  // Sets only the status and updatedAt, without rewriting the rest of the post.
  close(id: string, updatedAt: Date): Promise<void>;
  remove(id: string): Promise<void>;
  // Newest first; passing the last post's id as `before` starts the next page.
  listOpen(excludeOwnerId: string, limit: number, filter?: OpenPostFilter): Promise<T[]>;
  // Every open post in a category from everyone except excludeOwnerId: the
  // candidates the matching feed filters and ranks.
  listOpenInCategory(category: string, excludeOwnerId: string): Promise<T[]>;
  // Every category in use, open or closed.
  listCategories(): Promise<string[]>;
  renameCategory(from: string, to: string): Promise<void>;
  // One query for a page of posts; only the named fields are returned.
  findByIds(ids: string[], fields: (keyof T)[], firstPhotoOnly?: boolean): Promise<Partial<T>[]>;
}

export interface OptionCollection {
  list(field: string): Promise<Option[]>;
  // Inserts if missing and returns the stored option either way.
  ensure(option: Option): Promise<Option>;
  // Inserts every missing option in a single round trip; existing ones are untouched.
  ensureMany(options: Option[]): Promise<void>;
  remove(field: string, key: string): Promise<void>;
}

export interface CustomFieldCollection {
  list(ownerId: string): Promise<CustomField[]>;
  upsert(def: CustomField): Promise<CustomField>;
  remove(ownerId: string, key: string): Promise<boolean>;
}
