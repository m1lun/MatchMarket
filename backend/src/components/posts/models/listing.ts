import type { PostField, Condition, GeoPoint, PostStatus } from '../../../shared/models/common';

export const LISTINGS_COLLECTION = 'listings';

export interface Listing {
  id: string;
  ownerId: string;
  name: string;
  category: string;
  price: number;
  condition: Condition;
  description: string;
  address: string;
  location: GeoPoint;
  photoIds: string[];
  listingFields: PostField[];
  status: PostStatus;
  createdAt: Date;
  updatedAt: Date;
}
