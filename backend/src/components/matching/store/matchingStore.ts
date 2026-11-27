import { ObjectId, type Collection, type Document } from 'mongodb';
import { TEST_OWNER_PREFIX, testPartnerId } from '../../../shared/models/common';
import type { OpenPostFilter } from '../../posts/store/types';

// The radius MongoDB uses for $centerSphere, which takes distances in radians.
const EARTH_RADIUS_KM = 6378.1;

// Other users' posts, without test posts except the caller's own test seller's.
function visibleOwners(me: string): Document {
  const notATestOwner = { ownerId: { $not: { $regex: `^${TEST_OWNER_PREFIX}` } } };
  return { $and: [{ ownerId: { $ne: me } }, { $or: [notATestOwner, { ownerId: testPartnerId(me) }] }] };
}

// Sorted by _id, which grows with insertion time and is unique, so pages never overlap.
export async function findOpen(
  collection: Collection,
  priceQuery: (range: Document) => Document,
  excludeOwnerId: string,
  limit: number,
  filter: OpenPostFilter,
): Promise<unknown[]> {
  const query: Document = { status: 'open', ...visibleOwners(excludeOwnerId) };
  if (filter.before !== undefined) {
    query._id = { $lt: new ObjectId(filter.before) };
  }
  if (filter.category !== undefined) {
    query.category = filter.category;
  }
  if (filter.minPrice !== undefined || filter.maxPrice !== undefined) {
    Object.assign(query, priceQuery({
      ...(filter.minPrice === undefined ? {} : { $gte: filter.minPrice }),
      ...(filter.maxPrice === undefined ? {} : { $lte: filter.maxPrice }),
    }));
  }
  if (filter.near !== undefined) {
    // $centerSphere rather than $near, so results keep the newest-first order.
    const { lat, lng, radiusKm } = filter.near;
    query.location = { $geoWithin: { $centerSphere: [[lng, lat], radiusKm / EARTH_RADIUS_KM] } };
  }
  const found: unknown = await collection.find(query).sort({ _id: -1 }).limit(limit).toArray();
  return found as unknown[];
}

// Uses the { status, category } index.
export async function findOpenInCategory(collection: Collection, category: string, excludeOwnerId: string): Promise<unknown[]> {
  const found: unknown = await collection.find({ status: 'open', category, ...visibleOwners(excludeOwnerId) }).toArray();
  return found as unknown[];
}
