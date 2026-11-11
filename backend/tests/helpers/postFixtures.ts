import type { Db } from 'mongodb';

import { CUSTOM_FIELDS_COLLECTION } from '../../src/models/customField';
import { LISTINGS_COLLECTION } from '../../src/models/listing';
import { OPTIONS_COLLECTION } from '../../src/models/option';
import { REQUESTS_COLLECTION } from '../../src/models/request';
import type { PostCollection, PostDoc, Store } from '../../src/store/types';
import { PHOTO_ID, makeListing, makeRequest } from './dealFixtures';

type Body = Record<string, unknown>;

export const LOCATION = { longitude: -123.25, latitude: 49.26 };

export interface PostKind {
  label: 'Listing' | 'Request';
  path: '/api/listings' | '/api/requests';
  collection: string;
  fieldsKey: 'listingFields' | 'requestFields';
  baseFields: Body[];
  // The schema requires `hard` on request fields.
  fieldDefaults: Body;
  sizeError: string;
  body: (overrides?: Body) => Body;
  make: (store: Store, ownerId: string, overrides?: Partial<PostDoc>) => Promise<PostDoc>;
  collectionOf: (store: Store) => PostCollection<PostDoc>;
}

export const LISTING: PostKind = {
  label: 'Listing',
  path: '/api/listings',
  collection: LISTINGS_COLLECTION,
  fieldsKey: 'listingFields',
  baseFields: [],
  fieldDefaults: {},
  sizeError: 'size must be at least 0',
  body: (overrides = {}) => ({
    name: 'IKEA oak desk',
    category: 'desk',
    address: '6335 Thunderbird Crescent, Vancouver',
    description: 'Solid oak',
    location: LOCATION,
    photoIds: [PHOTO_ID],
    listingFields: [],
    price: 60,
    condition: 'good',
    ...overrides,
  }),
  make: (store, ownerId, overrides = {}) => makeListing(store, ownerId, overrides),
  collectionOf: (store) => store.listings as unknown as PostCollection<PostDoc>,
};

const MAX_PRICE: Body = { kind: 'builtin', key: 'price', value: 100, hard: true };

export const REQUEST: PostKind = {
  label: 'Request',
  path: '/api/requests',
  collection: REQUESTS_COLLECTION,
  fieldsKey: 'requestFields',
  baseFields: [MAX_PRICE],
  fieldDefaults: { hard: false },
  sizeError: 'max size must be at least 0',
  body: (overrides = {}) => ({
    name: 'Standing desk',
    category: 'desk',
    address: '6335 Thunderbird Crescent, Vancouver',
    description: 'For my home office',
    location: LOCATION,
    requestFields: [MAX_PRICE],
    ...overrides,
  }),
  // Labelled as the API stores it, so edits leave it unchanged.
  make: (store, ownerId, overrides = {}) =>
    makeRequest(store, ownerId, {
      requestFields: [{ key: 'price', label: 'Max price', kind: 'builtin', type: 'number', value: 50, hard: true }],
      ...overrides,
    }),
  collectionOf: (store) => store.requests as unknown as PostCollection<PostDoc>,
};

export function fieldsWith(kind: PostKind, fields: Body[]): Body[] {
  return [...kind.baseFields, ...fields.map((field) => ({ ...kind.fieldDefaults, ...field }))];
}

export function withFields(kind: PostKind, fields: Body[]): Body {
  return kind.body({ [kind.fieldsKey]: fieldsWith(kind, fields) });
}

export function asJson(post: PostDoc | null): unknown {
  return JSON.parse(JSON.stringify(post)) as unknown;
}

export async function countIn(db: Db, collection: string): Promise<number> {
  const count: unknown = await db.collection(collection).countDocuments();
  return count as number;
}

const POST_COLLECTIONS = [LISTINGS_COLLECTION, REQUESTS_COLLECTION, OPTIONS_COLLECTION, CUSTOM_FIELDS_COLLECTION];

export async function clearPostData(db: Db): Promise<void> {
  await Promise.all(
    POST_COLLECTIONS.map(async (name) => {
      await db.collection(name).deleteMany({});
    })
  );
}
