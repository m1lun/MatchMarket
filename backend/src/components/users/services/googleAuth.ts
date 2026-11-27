import { OAuth2Client } from 'google-auth-library';

import { env } from '../../../shared/config/env';

export interface GoogleUser {
  // Google account id (`sub`), stable across name and email changes.
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  // Profile photo, or null when Google sends none.
  pictureUrl: string | null;
}

// Created once so Google's public signing keys are cached between requests.
const tokenVerifier = new OAuth2Client();

// Checks the token's signature against Google's keys, that it was issued to
// our client ID, that Google issued it, and that it has not expired.
// Throws if any of those fail.
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleUser> {
  const ticket = await tokenVerifier.verifyIdToken({
    idToken,
    audience: env.googleClientId,
  });

  const payload = ticket.getPayload();
  if (payload === undefined) {
    throw new Error('Token carried no payload.');
  }

  if (payload.email_verified !== true) {
    throw new Error('Google account has no verified email address.');
  }

  return {
    id: payload.sub,
    firstName: payload.given_name ?? '',
    lastName: payload.family_name ?? '',
    email: payload.email ?? '',
    pictureUrl: payload.picture ?? null,
  };
}
