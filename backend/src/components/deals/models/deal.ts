import { BadRequestError } from '../../../shared/errors';

export const DEALS_COLLECTION = 'deals';

export interface Deal {
  id: string;
  listingId: string | null;
  requestId: string | null;
  sellerId: string;
  buyerId: string;
  agreedPrice: number;
  createdAt: Date;
}

export type DealRole = 'seller' | 'buyer';

export function roleOf(deal: Deal, userId: string): DealRole {
  return deal.sellerId === userId ? 'seller' : 'buyer';
}

// The other party of a deal the user is in.
export function otherParty(deal: Deal, userId: string): string {
  return deal.sellerId === userId ? deal.buyerId : deal.sellerId;
}

// A deal comes from a listing, a request or both; with neither it says nothing about what was sold.
export function assertHasPost(deal: Pick<Deal, 'listingId' | 'requestId'>): void {
  if (!deal.listingId && !deal.requestId) {
    throw new BadRequestError(['a deal needs a listing or a request']);
  }
}
