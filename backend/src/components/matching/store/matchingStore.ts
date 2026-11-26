import { ObjectId, type Collection, type Document } from 'mongodb';
import type { OpenPostFilter } from '../../posts/store/types';

// The radius MongoDB uses for $centerSphere, which takes distances in radians.
const EARTH_RADIUS_KM = 6378.1;

// Sorted by _id, which grows with insertion time and is unique, so pages never overlap.
export async function findOpen(
  collection: Collection,
  priceQuery: (range: Document) => Document,
  excludeOwnerId: string,
  limit: number,
  filter: OpenPostFilter,
): Promise<unknown[]> {
  const query: Document = { status: 'open', ownerId: { $ne: excludeOwnerId } };
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
  const found: unknown = await collection.find({ status: 'open', category, ownerId: { $ne: excludeOwnerId } }).toArray();
  return found as unknown[];
}
