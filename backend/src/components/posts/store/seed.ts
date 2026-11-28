import { normaliseCategory, normaliseKey } from '../../../shared/models/common';
import { DEFAULT_OPTIONS } from '../models/option';
import type { Store } from '../../../shared/store/types';

async function renameStoredCategories(posts: Store['listings'] | Store['requests']): Promise<void> {
  const categories = await posts.listCategories();
  await Promise.all(
    categories
      .filter((category) => normaliseCategory(category) !== category)
      .map((category) => posts.renameCategory(category, normaliseCategory(category))),
  );
}

// Each plural option becomes its singular, merging with that option if it already exists.
async function mergeCategoryOptions(store: Store): Promise<void> {
  const options = await store.options.list('category');
  await Promise.all(
    options
      .filter((option) => normaliseCategory(option.key) !== option.key)
      .map(async (option) => {
        const key = normaliseCategory(option.key);
        await store.options.ensure({ ...option, key, label: key });
        await store.options.remove(option.field, option.key);
      }),
  );
}

// Makes categories saved before they were singular match the ones saved now, since the
// feed compares them exactly; safe to run on every start.
export async function normaliseStoredCategories(store: Store): Promise<void> {
  await Promise.all([renameStoredCategories(store.listings), renameStoredCategories(store.requests), mergeCategoryOptions(store)]);
}

// Inserts the built-in options that are missing, in one round trip;
// safe to run on every start.
export async function seedOptions(store: Store): Promise<void> {
  const createdAt = new Date();
  const options = Object.entries(DEFAULT_OPTIONS).flatMap(([field, labels]) =>
    labels.map((label) => ({
      field,
      key: normaliseKey(label),
      label,
      builtin: true,
      createdBy: null,
      createdAt,
    })),
  );
  await store.options.ensureMany(options);
}
