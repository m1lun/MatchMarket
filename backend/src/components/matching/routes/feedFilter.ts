import { normaliseCategory } from '../../../shared/models/common';
import type { Listing } from '../../posts/models/listing';
import type { BuyerRequest } from '../../posts/models/request';
import { distanceKm } from '../logic/distance';
import type { PostFilter } from '../../posts/store/types';

export const MAX_RADIUS_KM = 100;

export const FILTER_PARAMS = ['category', 'minPrice', 'maxPrice', 'lat', 'lng', 'radiusKm'];

const DECIMAL = /^-?\d+\.?\d*$/;

function parseCategory(value: unknown, errors: string[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push('category must not be empty');
    return undefined;
  }
  return normaliseCategory(value);
}

function parseNumber(name: string, value: unknown, min: number, max: number, errors: string[]): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const number = typeof value === 'string' && DECIMAL.test(value) ? Number(value) : NaN;
  if (!(number >= min && number <= max)) {
    errors.push(max === Infinity ? `${name} must be a number from ${min} up` : `${name} must be a number from ${min} to ${max}`);
    return undefined;
  }
  return number;
}

export function parsePostFilter(query: Record<string, unknown>, errors: string[]): PostFilter {
  const minPrice = parseNumber('minPrice', query.minPrice, 0, Infinity, errors);
  const maxPrice = parseNumber('maxPrice', query.maxPrice, 0, Infinity, errors);
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    errors.push('minPrice must not be more than maxPrice');
  }

  // A distance without its centre or radius can't be applied, so it is an error rather than ignored.
  const distanceParams = [query.lat, query.lng, query.radiusKm];
  const sent = distanceParams.filter((value) => value !== undefined).length;
  if (sent !== 0 && sent !== distanceParams.length) {
    errors.push('lat, lng and radiusKm must be sent together');
  }
  const lat = parseNumber('lat', query.lat, -90, 90, errors);
  const lng = parseNumber('lng', query.lng, -180, 180, errors);
  const radiusKm = parseNumber('radiusKm', query.radiusKm, 0, MAX_RADIUS_KM, errors);
  const near = lat !== undefined && lng !== undefined && radiusKm !== undefined ? { lat, lng, radiusKm } : undefined;

  return { category: parseCategory(query.category, errors), minPrice, maxPrice, near };
}

function price(post: Listing | BuyerRequest): number | undefined {
  if ('price' in post) {
    return post.price;
  }
  const budget = post.requestFields.find((field) => field.key === 'price')?.value;
  return typeof budget === 'number' ? budget : undefined;
}

// The same rule as MongoPostCollection.listOpen, for posts already loaded. A request
// with no budget fails any price filter, as it does in MongoDB.
export function passesFilter(post: Listing | BuyerRequest, filter: PostFilter): boolean {
  const { category, minPrice, maxPrice, near } = filter;
  const postPrice = price(post);
  return (
    (category === undefined || post.category === category) &&
    (minPrice === undefined || (postPrice !== undefined && postPrice >= minPrice)) &&
    (maxPrice === undefined || (postPrice !== undefined && postPrice <= maxPrice)) &&
    (near === undefined ||
      distanceKm({ type: 'Point', coordinates: [near.lng, near.lat] }, post.location) <= near.radiusKm)
  );
}
