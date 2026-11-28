import { createHash, randomBytes, randomUUID } from 'node:crypto';

import jwt, { type JwtPayload } from 'jsonwebtoken';

import { env } from '../../../shared/config/env';
import type { GoogleUser } from './googleAuth';
import type { SignInProfile } from '../models/user';
import type { SessionRepo, UserCollection } from '../store/types';

// Google is only asked once, at sign-in. After that the app holds two tokens
// from this server: a short-lived session token sent on every request, and a
// long-lived refresh token that trades for a new pair at /api/auth/refresh.

// Short, so a leaked session token is soon useless; the app renews it with
// the refresh token without the user noticing.
export const SESSION_TTL_SECONDS = 15 * 60;
// How long a user stays signed in without opening the app.
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

const ISSUER = 'matchmarket-backend';
const AUDIENCE = 'matchmarket-app';

// Who a valid session token belongs to.
export interface SessionUser {
  // Google account id (`sub`).
  id: string;
  email: string;
}

// Response body of /api/auth/google and /api/auth/refresh.
export interface AuthResponse {
  firstName: string;
  lastName: string;
  email: string;
  sessionToken: string;
  // Seconds until sessionToken expires.
  sessionExpiresIn: number;
  refreshToken: string;
}

// Starts a new sign-in for a user Google has just vouched for.
export function startSession(repo: SessionRepo, user: GoogleUser, users?: UserCollection): Promise<AuthResponse> {
  return issueTokens(repo, user, randomUUID(), new Date(), users);
}

// Trades a refresh token for a new pair. The old token stops working at once
// (rotation). Presenting a token that was already traded means two parties
// hold it, so every token from that sign-in is revoked and both must sign in
// again. Null when the token is unknown, expired, used or revoked.
export async function refreshSession(
  repo: SessionRepo,
  refreshToken: string,
  users?: UserCollection
): Promise<AuthResponse | null> {
  const tokenHash = hashToken(refreshToken);
  const now = new Date();
  const session = await repo.consume(tokenHash, now);

  if (session === null) {
    const known = await repo.find(tokenHash);
    if (known?.usedAt instanceof Date) {
      await repo.revokeFamily(known.familyId);
    }
    return null;
  }

  // The session row has no photo, so the user's stored photo is kept.
  const user = {
    id: session.userId,
    email: session.email,
    firstName: session.firstName,
    lastName: session.lastName,
  };
  return issueTokens(repo, user, session.familyId, now, users);
}

// Signs out: revokes every token from the sign-in this refresh token belongs to.
export async function endSession(repo: SessionRepo, refreshToken: string): Promise<void> {
  const session = await repo.find(hashToken(refreshToken));
  if (session !== null) {
    await repo.revokeFamily(session.familyId);
  }
}

// Returns the user a session token was issued to. Throws if it is forged,
// expired, or was not issued by this server for the app.
export function verifySessionToken(token: string): SessionUser {
  const claims = jwt.verify(token, env.jwtSecret, {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: AUDIENCE,
  }) as JwtPayload;

  const sub: unknown = claims.sub;
  const email: unknown = claims.email;
  if (typeof sub !== 'string' || typeof email !== 'string') {
    throw new Error('Session token is missing its claims.');
  }

  return { id: sub, email };
}

async function issueTokens(
  repo: SessionRepo,
  user: SignInProfile,
  familyId: string,
  now: Date,
  users: UserCollection | undefined
): Promise<AuthResponse> {
  await saveUser(users, user);
  const refreshToken = randomBytes(32).toString('base64url');
  await repo.insert({
    tokenHash: hashToken(refreshToken),
    familyId,
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    createdAt: now,
    expiresAt: new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000),
    usedAt: null,
  });

  const sessionToken = jwt.sign({ email: user.email }, env.jwtSecret, {
    algorithm: 'HS256',
    subject: user.id,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: SESSION_TTL_SECONDS,
  });

  return {
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    sessionToken,
    sessionExpiresIn: SESSION_TTL_SECONDS,
    refreshToken,
  };
}

// The users collection only supplies names and photos to other features, so a
// failed save is logged rather than failing the sign-in; the next refresh
// saves the user again.
async function saveUser(users: UserCollection | undefined, user: SignInProfile): Promise<void> {
  try {
    await users?.upsertFromSignIn(user);
  } catch (error) {
    console.error(`Could not save user ${user.id}: ${String(error)}`);
  }
}

// Refresh tokens are 256 random bits, so a fast unsalted hash is enough: there
// is nothing to brute-force, and the lookup stays a single indexed query.
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
