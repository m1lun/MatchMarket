// MongoDB $jsonSchema validators for the Posts collections.
import type { Document } from 'mongodb';

import {
  CONDITIONS,
  FIELD_TYPES,
  MAX_ADDRESS_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PHOTOS,
  MAX_FIELDS,
  MAX_TEXT_VALUE_LENGTH,
  PHOTO_ID,
  POST_STATUSES,
  RESERVED_KEYS,
} from '../../../shared/models/common';
import { date, key, label, location, object, text } from '../../../shared/models/schemaHelpers';

const photoIds = (minItems: number): Document => ({
  bsonType: 'array',
  minItems,
  maxItems: MAX_PHOTOS,
  items: { bsonType: 'string', pattern: PHOTO_ID.source },
});

const fieldProperties = {
  key,
  label,
  kind: { enum: ['builtin', 'custom'] },
  type: { enum: [...FIELD_TYPES, 'dimensions'] },
  value: {
    anyOf: [{ bsonType: 'string', maxLength: MAX_TEXT_VALUE_LENGTH }, { bsonType: ['number', 'bool', 'object'] }],
  },
};

// A field is either built-in, or custom with a key that no built-in field uses.
const fieldRule = {
  anyOf: [
    { properties: { kind: { enum: ['builtin'] } } },
    { properties: { kind: { enum: ['custom'] }, key: { not: { enum: [...RESERVED_KEYS] } } } },
  ],
};

const fieldList = (item: Document): Document => ({ bsonType: 'array', maxItems: MAX_FIELDS, items: item });

const postProperties = {
  ownerId: text(),
  name: text(MAX_NAME_LENGTH),
  category: key,
  description: { bsonType: 'string', maxLength: MAX_DESCRIPTION_LENGTH },
  address: text(MAX_ADDRESS_LENGTH),
  location,
  status: { enum: [...POST_STATUSES] },
  createdAt: date,
  updatedAt: date,
};

export const listingSchema = object({
  ...postProperties,
  price: { bsonType: 'number', minimum: 0 },
  condition: { enum: [...CONDITIONS] },
  photoIds: photoIds(1),
  listingFields: fieldList(object(fieldProperties, [], fieldRule)),
});

// Requests may have no photos, and a hard field has no importance.
export const requestSchema = object({
  ...postProperties,
  photoIds: photoIds(0),
  requestFields: fieldList(
    object(
      { ...fieldProperties, hard: { bsonType: 'bool' }, importance: { bsonType: 'int', minimum: 1, maximum: 5 } },
      ['importance'],
      fieldRule,
    ),
  ),
});

export const optionSchema = object({
  field: label,
  key,
  label,
  builtin: { bsonType: 'bool' },
  createdBy: { bsonType: ['string', 'null'] },
  createdAt: date,
});

export const customFieldSchema = object({
  ownerId: text(),
  key,
  label,
  type: { enum: [...FIELD_TYPES] },
});
