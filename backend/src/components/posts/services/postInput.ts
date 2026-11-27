import { BadRequestError } from '../../../shared/errors';
import { CONDITIONS, MAX_NAME_LENGTH, MAX_PHOTOS, PHOTO_ID, RESERVED_KEYS, isOneOf, normaliseKey, type PostField, type GeoPoint } from '../../../shared/models/common';
import type { PostDoc } from '../store/types';
import { isNumber, isObject, isText, parseLocation, type Body } from '../../../shared/http/checks';

// What parsePost returns. The fields are saved as `listingFields` (listing) or `requestFields`
// (request). `extra` is the price and condition of a listing
//
// A listing:  { name: 'IKEA oak desk', category: 'Furniture', address: '6335 Thunderbird Cres', description: '',
//               location: {...}, photoIds: ['6ad40b88e74dd3678bfef8f3'],
//               fields: [{ kind: 'builtin', key: 'brand', value: 'ikea', ... }], extra: { price: 10, condition: 'new' } }
//
// A request:  { name: 'Standing desk', category: 'Furniture', address: '6335 Thunderbird Cres', description: '',
//               location: {...}, photoIds: [], fields: [{ kind: 'builtin', key: 'price', value: 120, hard: true, ... }],
//               extra: {} }
export interface ParsedPost {
  name: string;
  category: string;
  address: string;
  description: string;
  location: GeoPoint;
  photoIds: string[];
  fields: PostField[];
  extra: Body;
}

interface BuiltinField {
  label: string;
  type: PostField['type'];
}

type Builtins = Record<string, BuiltinField>;

export interface PostType {
  builtins: Builtins;
  fieldsKey: 'listingFields' | 'requestFields';
  minPhotos: number;
  parseExtra(body: Body, fields: PostField[], errors: string[]): Body;
}

// Set by the server; never taken from a PATCH body.
const SERVER_FIELDS = ['id', 'ownerId', 'status', 'createdAt', 'updatedAt'];

function parsePhotos(value: unknown, minPhotos: number, errors: string[]): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !PHOTO_ID.test(id))) {
    errors.push('photoIds must be an array of ids returned by POST /api/photos');
    return [];
  }
  if (value.length < minPhotos) {
    errors.push(`at least ${minPhotos} photo is required`);
  }
  if (value.length > MAX_PHOTOS) {
    errors.push(`at most ${MAX_PHOTOS} photos are allowed`);
  }
  return value as string[];
}

// A custom field arrives as { label, type, value }; the key comes from the label.
function parseCustomField(field: Body, fieldName: string, errors: string[]): PostField | null {
  const key = isText(field.label) ? normaliseKey(field.label) : '';
  if (key === '') {
    errors.push(`${fieldName} needs a label`);
    return null;
  }
  if (isOneOf(RESERVED_KEYS, key)) {
    errors.push(`"${String(field.label)}" is already a built-in field, so there is no need to add it as a custom field`);
    return null;
  }
  return { ...field, key } as PostField;
}

// Numbers and dimensions are measurements (prices, radius, sizes), so they can't be negative.
function hasNegativeNumber(value: unknown): boolean {
  if (typeof value === 'number') {
    return value < 0;
  }
  return isObject(value) && Object.values(value).some((part) => typeof part === 'number' && part < 0);
}

// A built-in field arrives as { key, value }; the label and type come from the built-ins.
function parseBuiltinField(field: Body, builtins: Builtins, fieldName: string, errors: string[]): PostField | null {
  const key = normaliseKey(String(field.key));
  const builtin = Object.entries(builtins).find(([builtinKey]) => builtinKey === key)?.[1];
  if (builtin === undefined) {
    errors.push(`${fieldName} has an unknown field "${String(field.key)}"`);
    return null;
  }
  if ((builtin.type === 'number' || builtin.type === 'dimensions') && hasNegativeNumber(field.value)) {
    errors.push(`${builtin.label.toLowerCase()} must be at least 0`);
    return null;
  }
  return { ...field, kind: 'builtin', key, label: builtin.label, type: builtin.type } as PostField;
}

function parseFields(value: unknown, builtins: Builtins, name: string, errors: string[]): PostField[] {
  if (!Array.isArray(value) || value.some((field) => !isObject(field))) {
    errors.push(`${name} must be an array`);
    return [];
  }
  const fields: PostField[] = [];
  (value as Body[]).forEach((field, index) => {
    // For example "listingFields[2]", so an error says which field is wrong.
    const fieldName = `${name}[${index}]`;
    const parsed =
      field.kind === 'custom' ? parseCustomField(field, fieldName, errors) : parseBuiltinField(field, builtins, fieldName, errors);
    if (parsed !== null) {
      fields.push(parsed);
    }
  });
  return fields;
}

// Checks the common mistakes with clear messages; the schema checks the rest.
//
// CREATE:  request body ──parsePost──▶ ParsedPost ──toPost──▶ post to save
// PATCH:    stored post ──toBody──▶ body, with the changes merged in ──parsePost──▶ ParsedPost ──toPost──▶ post to save
export function parsePost(postType: PostType, body: unknown): ParsedPost {
  if (!isObject(body)) {
    throw new BadRequestError(['request body must be a JSON object']);
  }
  const errors: string[] = [];
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name === '') {
    errors.push('name is required');
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name must be at most ${MAX_NAME_LENGTH} characters`);
  }
  const category = isText(body.category) ? body.category : '';
  if (category === '') {
    errors.push('category is required');
  }
  const address = isText(body.address) ? body.address : '';
  if (address === '') {
    errors.push('address is required');
  }
  if (body.description !== undefined && typeof body.description !== 'string') {
    errors.push('description must be a string');
  }
  const description = typeof body.description === 'string' ? body.description : '';
  const location = parseLocation(body.location, errors);
  const photoIds = parsePhotos(body.photoIds ?? [], postType.minPhotos, errors);
  const fields = parseFields(body[postType.fieldsKey], postType.builtins, postType.fieldsKey, errors);
  const extra = postType.parseExtra(body, fields, errors);
  if (errors.length > 0) {
    throw new BadRequestError(errors);
  }
  return { name, category, address, description, location, photoIds, fields, extra };
}

// The post to save.
export function toPost(postType: PostType, parsed: ParsedPost): Body {
  const { fields, extra, ...common } = parsed;
  return { ...common, ...extra, [postType.fieldsKey]: fields };
}

// A stored post as a client would send it, so a PATCH can merge changes over it.
export function toBody(post: PostDoc): Body {
  const body = Object.fromEntries(Object.entries(post).filter(([name]) => !SERVER_FIELDS.includes(name)));
  return {
    ...body,
    location: { longitude: post.location.coordinates[0], latitude: post.location.coordinates[1] },
  };
}


export const LISTING_RULES: PostType = {
  builtins: {
    brand: { label: 'Brand', type: 'text' },
    colour: { label: 'Colour', type: 'text' },
    dimensions: { label: 'Size', type: 'dimensions' },
  },
  fieldsKey: 'listingFields',
  minPhotos: 1,
  parseExtra(body, _fields, errors) {
    if (!isNumber(body.price) || body.price < 0) {
      errors.push('price must be a number of at least 0');
    }
    if (typeof body.condition !== 'string' || !isOneOf(CONDITIONS, body.condition)) {
      errors.push(`condition must be one of: ${CONDITIONS.join(', ')}`);
    }
    return { price: body.price, condition: body.condition };
  },
};

export const REQUEST_RULES: PostType = {
  builtins: {
    price: { label: 'Max price', type: 'number' },
    condition: { label: 'Min condition', type: 'text' },
    dimensions: { label: 'Max size', type: 'dimensions' },
    radiuskm: { label: 'Radius (km)', type: 'number' },
    brand: { label: 'Brand', type: 'text' },
    colour: { label: 'Colour', type: 'text' },
  },
  fieldsKey: 'requestFields',
  minPhotos: 0,
  parseExtra(_body, fields, errors) {
    if (!fields.some((field) => field.kind === 'builtin' && field.key === 'price')) {
      errors.push('a max price is required');
    }
    const condition = fields.find((field) => field.kind === 'builtin' && field.key === 'condition');
    if (
      condition !== undefined &&
      (typeof condition.value !== 'string' || !isOneOf(CONDITIONS, condition.value))
    ) {
      errors.push(`min condition must be one of: ${CONDITIONS.join(', ')}`);
    }
    return {};
  },
};
