// One row per refresh token. Rows from the same sign-in share a familyId, so a
// reused (stolen) token can revoke every token that sign-in has produced.
export const SESSIONS_COLLECTION = 'sessions';

export interface RefreshSession {
  // SHA-256 of the refresh token. The token itself is never stored.
  tokenHash: string;
  familyId: string;
  // Google account id (`sub`).
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: Date;
  // MongoDB deletes the row once this passes (TTL index).
  expiresAt: Date;
  // Set when the token is exchanged; presenting it again counts as reuse.
  usedAt: Date | null;
}
