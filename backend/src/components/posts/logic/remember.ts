import { FIELD_TYPES, isOneOf, normaliseCategory, normaliseKey, type PostField } from '../../../shared/models/common';
import type { Option } from '../models/option';
import type { Store } from '../../../shared/store/types';

// Brand and colour values are suggested from the saved options.
const OPTION_FIELDS = ['brand', 'colour'];

// An option created from a value a user typed, so it is offered to everyone next time.
export function newOption(field: string, text: string, ownerId: string): Option {
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

// After a post is saved, remembers the new values it used so they are offered next time:
// its category, any brand or colour, the text values of custom fields, and the custom
// fields themselves. Values that are already saved are left as they are.
export async function rememberNewValues(
  store: Store,
  ownerId: string,
  category: string,
  fields: PostField[],
): Promise<void> {
  const saves: Promise<unknown>[] = [store.options.ensure(newOption('category', category, ownerId))];
  for (const field of fields) {
    const key = normaliseKey(field.key);
    const value = textValue(field);
    if (field.kind === 'custom' && isOneOf(FIELD_TYPES, field.type)) {
      saves.push(store.customFields.upsert({ ownerId, key, label: field.label.trim(), type: field.type }));
    }
    if (value !== null && (field.kind === 'custom' || OPTION_FIELDS.includes(key))) {
      saves.push(store.options.ensure(newOption(key, value, ownerId)));
    }
  }
  await Promise.all(saves);
}
