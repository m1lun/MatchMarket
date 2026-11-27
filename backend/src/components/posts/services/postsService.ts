import type { Readable } from 'node:stream';

import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { FIELD_TYPES, isOneOf, normaliseCategory, normaliseKey, type PostField } from '../../../shared/models/common';
import { isObject } from '../../../shared/http/checks';
import type { CustomField } from '../models/customField';
import type { Listing } from '../models/listing';
import type { Option } from '../models/option';
import type { BuyerRequest } from '../models/request';
import type { PhotoStorage } from '../store/photoStorage';
import type { CustomFieldCollection, OpenPostFilter, OptionCollection, PostCollection } from '../store/types';
import { LISTING_RULES, REQUEST_RULES, parsePost, toBody, toPost, type PostType } from './postInput';

export { PHOTO_TYPES } from '../store/photoStorage';
export type { OpenPostFilter, PostFilter } from '../store/types';

export type PostKind = 'listing' | 'request';
export type PostOf<K extends PostKind> = K extends 'listing' ? Listing : BuyerRequest;

export interface PostsStore {
  listings: PostCollection<Listing>;
  requests: PostCollection<BuyerRequest>;
  options: OptionCollection;
  customFields: CustomFieldCollection;
  photos: PhotoStorage;
}

export interface PhotoUpload {
  data: Buffer;
  mimeType: string;
}

// Brand and colour values are suggested from the saved options.
const OPTION_FIELDS = ['brand', 'colour'];

// An option created from a value a user typed, so it is offered to everyone next time.
function newOption(field: string, text: string, ownerId: string): Option {
  const fieldKey = normaliseKey(field);
  // A category's option is the category as posts save it, so it is only listed once.
  const label = fieldKey === 'category' ? normaliseCategory(text) : text.trim().replace(/\s+/g, ' ');
  return {
    field: fieldKey,
    key: normaliseKey(label),
    label,
    builtin: false,
    createdBy: ownerId,
    createdAt: new Date(),
  };
}

function textValue(field: PostField): string | null {
  return field.type === 'text' && typeof field.value === 'string' && field.value.trim() !== '' ? field.value : null;
}

export class PostsService {
  constructor(private readonly store: PostsStore) {}

  async create<K extends PostKind>(kind: K, ownerId: string, body: unknown): Promise<PostOf<K>> {
    const rules = this.rules(kind);
    const parsed = parsePost(rules, body);
    const now = new Date();
    const created = await this.collection(kind).insert({
      ...toPost(rules, parsed),
      ownerId,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    } as unknown as Omit<PostOf<K>, 'id'>);
    await this.rememberNewValues(ownerId, parsed.category, parsed.fields);
    return created;
  }

  listMine<K extends PostKind>(kind: K, ownerId: string): Promise<PostOf<K>[]> {
    return this.collection(kind).listByOwner(ownerId);
  }

  async getMine<K extends PostKind>(kind: K, ownerId: string, id: string): Promise<PostOf<K>> {
    const post = await this.collection(kind).findById(id);
    if (post === null) {
      throw new NotFoundError();
    }
    if (post.ownerId !== ownerId) {
      throw new ForbiddenError();
    }
    return post;
  }

  async update<K extends PostKind>(kind: K, ownerId: string, id: string, body: unknown): Promise<PostOf<K>> {
    const post = await this.getMine(kind, ownerId, id);
    if (!isObject(body)) {
      throw new BadRequestError(['request body must be a JSON object']);
    }
    const { status = post.status, ...changes } = body;
    if (status !== 'open' && status !== 'closed') {
      throw new BadRequestError(['status must be "open" or "closed"']);
    }
    const rules = this.rules(kind);
    const parsed = parsePost(rules, { ...toBody(post), ...changes });
    const updated = await this.collection(kind).replace({
      ...post,
      ...toPost(rules, parsed),
      status,
      updatedAt: new Date(),
    } as PostOf<K>);
    await this.rememberNewValues(post.ownerId, parsed.category, parsed.fields);
    return updated;
  }

  async remove(kind: PostKind, ownerId: string, id: string): Promise<void> {
    const post = await this.getMine(kind, ownerId, id);
    await this.collection(kind).remove(post.id);
  }

  findById<K extends PostKind>(kind: K, id: string): Promise<PostOf<K> | null> {
    return this.collection(kind).findById(id);
  }

  findByIds<K extends PostKind>(
    kind: K,
    ids: string[],
    fields: (keyof PostOf<K>)[],
    firstPhotoOnly?: boolean,
  ): Promise<Partial<PostOf<K>>[]> {
    return this.collection(kind).findByIds(ids, fields, firstPhotoOnly);
  }

  listOpen<K extends PostKind>(kind: K, excludeOwnerId: string, limit: number, filter?: OpenPostFilter): Promise<PostOf<K>[]> {
    return this.collection(kind).listOpen(excludeOwnerId, limit, filter);
  }

  listOpenInCategory<K extends PostKind>(kind: K, category: string, excludeOwnerId: string): Promise<PostOf<K>[]> {
    return this.collection(kind).listOpenInCategory(category, excludeOwnerId);
  }

  async closeForDeal(listingId: string | null, requestId: string | null, now: Date): Promise<void> {
    await Promise.all([
      listingId === null ? undefined : this.store.listings.close(listingId, now),
      requestId === null ? undefined : this.store.requests.close(requestId, now),
    ]);
  }

  listOptions(field: string): Promise<Option[]> {
    return this.store.options.list(normaliseKey(field));
  }

  addOption(field: string, label: string, ownerId: string): Promise<Option> {
    return this.store.options.ensure(newOption(field, label, ownerId));
  }

  listCustomFields(ownerId: string): Promise<CustomField[]> {
    return this.store.customFields.list(ownerId);
  }

  async addCustomField(field: CustomField): Promise<CustomField> {
    const existing = (await this.store.customFields.list(field.ownerId)).find((saved) => saved.key === field.key);
    if (existing !== undefined) {
      throw new ConflictError(`You already have a custom field called "${existing.label}"`);
    }
    return this.store.customFields.upsert(field);
  }

  async removeCustomField(ownerId: string, key: string): Promise<void> {
    if (!(await this.store.customFields.remove(ownerId, normaliseKey(key)))) {
      throw new NotFoundError();
    }
  }

  savePhotos(photos: PhotoUpload[], ownerId: string): Promise<string[]> {
    return Promise.all(photos.map((photo) => this.store.photos.save(photo.data, photo.mimeType, ownerId)));
  }

  async openPhoto(id: string): Promise<{ mimeType: string; stream: Readable }> {
    const photo = await this.store.photos.open(id);
    if (photo === null) {
      throw new NotFoundError('Photo not found');
    }
    return photo;
  }

  // After a post is saved, remembers the new values it used so they are offered next time:
  // its category, any brand or colour, the text values of custom fields, and the custom
  // fields themselves. Values that are already saved are left as they are.
  private async rememberNewValues(ownerId: string, category: string, fields: PostField[]): Promise<void> {
    const saves: Promise<unknown>[] = [this.store.options.ensure(newOption('category', category, ownerId))];
    for (const field of fields) {
      const key = normaliseKey(field.key);
      const value = textValue(field);
      if (field.kind === 'custom' && isOneOf(FIELD_TYPES, field.type)) {
        saves.push(this.store.customFields.upsert({ ownerId, key, label: field.label.trim(), type: field.type }));
      }
      if (value !== null && (field.kind === 'custom' || OPTION_FIELDS.includes(key))) {
        saves.push(this.store.options.ensure(newOption(key, value, ownerId)));
      }
    }
    await Promise.all(saves);
  }

  private rules(kind: PostKind): PostType {
    return kind === 'listing' ? LISTING_RULES : REQUEST_RULES;
  }

  private collection<K extends PostKind>(kind: K): PostCollection<PostOf<K>> {
    return (kind === 'listing' ? this.store.listings : this.store.requests) as unknown as PostCollection<PostOf<K>>;
  }
}
