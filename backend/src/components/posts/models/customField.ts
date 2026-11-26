// A custom field a user created and can reuse on later posts.
import type { FieldType } from '../../../shared/models/common';

export const CUSTOM_FIELDS_COLLECTION = 'customFields';

export interface CustomField {
  ownerId: string;
  key: string;
  label: string;
  type: FieldType;
}
