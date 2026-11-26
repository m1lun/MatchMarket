// MongoDB $jsonSchema validators: the database rejects documents that miss a
// required field, have the wrong type, or use a value outside the allowed set.
import type { Document } from 'mongodb';

import { MAX_LABEL_LENGTH, NORMALISED_PATTERN } from './common';

// Every listed property is required unless it is named in `optional`.
export function object(properties: Record<string, Document>, optional: string[] = [], rules: Document = {}): Document {
  return {
    bsonType: 'object',
    required: Object.keys(properties).filter((name) => !optional.includes(name)),
    properties,
    ...rules,
  };
}

export const text = (maxLength?: number): Document => ({
  bsonType: 'string',
  minLength: 1,
  ...(maxLength === undefined ? {} : { maxLength }),
});
export const label = text(MAX_LABEL_LENGTH);
export const key = { ...label, pattern: NORMALISED_PATTERN };
export const date = { bsonType: 'date' };

export const location = object({
  type: { enum: ['Point'] },
  coordinates: {
    bsonType: 'array',
    minItems: 2,
    maxItems: 2,
    items: [
      { bsonType: 'number', minimum: -180, maximum: 180 },
      { bsonType: 'number', minimum: -90, maximum: 90 },
    ],
  },
});
