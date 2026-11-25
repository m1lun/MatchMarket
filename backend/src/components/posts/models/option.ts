// Options users can choose from or add to: category, brand, colour and every custom text field.
export const OPTIONS_COLLECTION = 'options';

export interface Option {
  field: string;
  key: string;
  label: string;
  builtin: boolean;
  createdBy: string | null;
  createdAt: Date;
}

export const DEFAULT_OPTIONS: Record<string, string[]> = {
  category: ['furniture', 'electronics', 'clothing', 'book', 'sports', 'other'],
  colour: ['black', 'white', 'grey', 'brown', 'blue', 'red', 'green', 'other'],
  brand: [],
};
