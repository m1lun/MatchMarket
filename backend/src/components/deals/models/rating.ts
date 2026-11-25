export const RATINGS_COLLECTION = 'ratings';

export interface Rating {
  id: string;
  dealId: string;
  raterId: string;
  ratedUserId: string;
  stars: number;
  comment: string;
  createdAt: Date;
  updatedAt?: Date;
}
