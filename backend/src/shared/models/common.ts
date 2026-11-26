export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
// A post refers to a stored photo by its id.
export const PHOTO_ID = /^[0-9a-f]{24}$/;
export const MAX_NAME_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_ADDRESS_LENGTH = 200;
export const MAX_LABEL_LENGTH = 60;
export const MAX_TEXT_VALUE_LENGTH = 100;
// Up to 6 built-in fields plus 10 custom fields.
export const MAX_FIELDS = 16;

// Keys used by built-in fields; custom fields can't take them. Already normalised.
export const RESERVED_KEYS = ['category', 'price', 'condition', 'dimensions', 'radiuskm', 'brand', 'colour'] as const;

// A normalised key: lower-case words separated by single spaces, no edge spaces.
export const NORMALISED_PATTERN = '^[^A-Z\\s]+( [^A-Z\\s]+)*$';

// Ordered best to worst. Condition is a fixed scale, not a user-extendable list.
export const CONDITIONS = ['new', 'like new', 'good', 'fair', 'poor'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const POST_STATUSES = ['open', 'closed'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const MIN_STARS = 1;
export const MAX_STARS = 5;
export const MAX_COMMENT_LENGTH = 300;
export const DEFAULT_DEALS_PAGE = 20;
export const MAX_DEALS_PAGE = 50;

export const FIELD_TYPES = ['text', 'number', 'bool'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

// Centimetres.
export interface Dimensions {
  width: number;
  height: number;
  depth: number;
}

export interface GeoPoint {
  type: 'Point';
  coordinates: [longitude: number, latitude: number];
}

export type FieldValue = string | number | boolean | Dimensions;

export interface PostField {
  key: string;
  label: string;
  kind: 'builtin' | 'custom';
  type: FieldType | 'dimensions';
  value: FieldValue;
}

// importance is omitted when hard: a hard field is a must-have.
export interface RequestField extends PostField {
  hard: boolean;
  importance?: number;
}

// Indexes shared by listings and requests: radius search for the feed, plus
// category browsing and "My posts" (newest first) lookups.
export const postIndexes = [
  { key: { location: '2dsphere' } },
  { key: { status: 1, category: 1 } },
  { key: { ownerId: 1, createdAt: -1 } },
] as const;

// Whether a string is one of a fixed list such as CONDITIONS, narrowing it to that list's type.
export function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

// Lower-cases, trims and collapses whitespace so "IKEA" and " ikea " are one key.
export function normaliseKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Words that only look plural, so they keep their trailing s.
const NOT_PLURAL = new Set([
  'atlas',
  'canvas',
  'clothes',
  'cosmetics',
  'electronics',
  'jeans',
  'lens',
  'news',
  'pants',
  'scissors',
  'series',
  'shorts',
  'species',
  'sports',
]);

// Plurals the rules in singular would get wrong.
const IRREGULAR_PLURALS = new Map([
  ['buses', 'bus'],
  ['cookies', 'cookie'],
  ['knives', 'knife'],
  ['movies', 'movie'],
  ['shelves', 'shelf'],
]);

function singular(word: string): string {
  const irregular = IRREGULAR_PLURALS.get(word);
  if (irregular !== undefined) {
    return irregular;
  }
  if (NOT_PLURAL.has(word) || word.length <= 3 || /(ss|us|is)$/.test(word)) {
    return word;
  }
  if (word.length > 4 && /[^aeiou]ies$/.test(word)) {
    return `${word.slice(0, -3)}y`;
  }
  if (/(ss|sh|ch|x|z)es$/.test(word)) {
    return word.slice(0, -2);
  }
  return word.endsWith('s') ? word.slice(0, -1) : word;
}

// A normalised key with its last word made singular, so "Office Chairs" and "office chair"
// are one category. Only simple plurals are handled; anything else is left as typed.
export function normaliseCategory(text: string): string {
  const key = normaliseKey(text);
  const lastWord = key.lastIndexOf(' ') + 1;
  return key.slice(0, lastWord) + singular(key.slice(lastWord));
}
