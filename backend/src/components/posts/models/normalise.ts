import { normaliseCategory, normaliseKey, type PostField } from '../../../shared/models/common';
import type { Listing } from './listing';
import type { BuyerRequest } from './request';

export class DuplicateFieldError extends Error {}

// Brand, colour and custom text values are chosen from the saved options, so they are
// lower-cased to match the stored option.
function isOptionText(field: PostField, key: string): boolean {
  return field.type === 'text' && (field.kind === 'custom' || key === 'brand' || key === 'colour');
}

function normaliseFields<R extends PostField>(fields: R[]): R[] {
  const seen = new Set<string>();
  return fields.map((field) => {
    const key = normaliseKey(field.key);
    if (seen.has(key)) {
      throw new DuplicateFieldError(`Duplicate field "${key}"`);
    }
    seen.add(key);
    const value = isOptionText(field, key) && typeof field.value === 'string' ? normaliseKey(field.value) : field.value;
    return { ...field, key, label: field.label.trim(), value };
  });
}

type NewPost<T> = Omit<T, 'id'>;

// The text fields every post has.
function tidyPost<T extends { category: string; description: string; address: string }>(doc: T): T {
  return {
    ...doc,
    category: normaliseCategory(doc.category),
    description: doc.description.trim(),
    address: doc.address.trim(),
  };
}

export function normaliseListing(doc: NewPost<Listing>): NewPost<Listing> {
  return { ...tidyPost(doc), listingFields: normaliseFields(doc.listingFields) };
}

export function normaliseRequest(doc: NewPost<BuyerRequest>): NewPost<BuyerRequest> {
  return { ...tidyPost(doc), requestFields: normaliseFields(doc.requestFields) };
}
