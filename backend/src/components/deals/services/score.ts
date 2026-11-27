import type { Reputation } from '../models/reputation';

export function averageScore(starSum: number, ratingCount: number): number {
  return starSum / ratingCount;
}

// A user as the Deals tab shows them: their average score (null until someone rates them) and rating count.
export function reputationSummary(
  userId: string,
  reputation: Reputation | null | undefined,
): { id: string; score: number | null; ratingCount: number } {
  return {
    id: userId,
    score: reputation ? averageScore(reputation.starSum, reputation.ratingCount) : null,
    ratingCount: reputation?.ratingCount ?? 0,
  };
}
