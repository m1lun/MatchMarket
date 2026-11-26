export const REPUTATIONS_COLLECTION = 'reputations';

export interface Reputation {
  userId: string;
  starSum: number;
  ratingCount: number;
  updatedAt: Date;
}
