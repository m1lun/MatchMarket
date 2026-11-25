import type { GeoPoint, PostStatus, RequestField } from '../../../shared/models/common';

export const REQUESTS_COLLECTION = 'requests';

export interface BuyerRequest {
  id: string;
  ownerId: string;
  name: string;
  category: string;
  description: string;
  address: string;
  location: GeoPoint;
  photoIds: string[];
  requestFields: RequestField[];
  status: PostStatus;
  createdAt: Date;
  updatedAt: Date;
}
