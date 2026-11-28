import type { Server } from 'node:http';

import { LoginTicket, OAuth2Client, type TokenPayload } from 'google-auth-library';
import jwt from 'jsonwebtoken';

import { env } from '../../src/shared/config/env';
import { SESSION_TTL_SECONDS } from '../../src/components/users/services/sessionService';
import type { Store } from '../../src/shared/store/types';
import { GOOGLE_USER, clearAuthData, getMe, postAuth, sessionRows, signIn, startAuthApp } from '../helpers/authFixtures';
import { expectServerError, rejecting } from '../helpers/storeFailures';
import { stopTestApp } from '../helpers/testApp';
import { createTestStore, type TestStore } from '../helpers/testStore';

let mongo: TestStore;
let app: Server;

beforeAll(async () => {
  mongo = await createTestStore();
  app = await startAuthApp(mongo.store);
});

afterAll(async () => {
  await stopTestApp(app);
  await mongo.dropAndClose();
});

beforeEach(async () => {
  await clearAuthData(mongo.db);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const ID_TOKEN = 'google-id-token';

// What Google's library returns for an ID token of GOOGLE_USER's verified account with no names or photo.
function anonymousPayload(): TokenPayload {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://accounts.google.com',
    aud: env.googleClientId,
    sub: GOOGLE_USER.id,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
    email: GOOGLE_USER.email,
    email_verified: true,
  };
}

// The same with GOOGLE_USER's names and photo, and any claim overridden.
function googlePayload(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return {
    ...anonymousPayload(),
    given_name: GOOGLE_USER.firstName,
    family_name: GOOGLE_USER.lastName,
    ...(GOOGLE_USER.pictureUrl === null ? {} : { picture: GOOGLE_USER.pictureUrl }),
    ...overrides,
  };
}

// Google's token check, which needs a real Google ID token and Google's keys.
function mockGoogle(): jest.SpyInstance {
  return jest.spyOn(OAuth2Client.prototype, 'verifyIdToken') as unknown as jest.SpyInstance;
}

function googleAccepts(payload?: TokenPayload): jest.SpyInstance {
  return mockGoogle().mockResolvedValue(new LoginTicket('envelope', payload));
}

// Interface POST /api/auth/google
describe('Mocked: POST /api/auth/google', () => {
  // Mocked behavior: Google's verifyIdToken accepts the token, for a verified account with names and a photo
  // Input: { idToken }
  // Expected status code: 200
  // Expected behavior: the token is checked once against our client ID, the user is saved, and one refresh token
  // is stored; the session token is accepted by a protected route
  // Expected output: the user's names and email, a sessionToken, sessionExpiresIn 900 and a refreshToken
  test('Google Accepts The Token', async () => {
    const google = googleAccepts(googlePayload());

    const response = await postAuth(app, 'google', { idToken: ID_TOKEN });

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      firstName: GOOGLE_USER.firstName,
      lastName: GOOGLE_USER.lastName,
      email: GOOGLE_USER.email,
      sessionToken: expect.any(String) as string,
      sessionExpiresIn: SESSION_TTL_SECONDS,
      refreshToken: expect.any(String) as string,
    });
    expect(google).toHaveBeenCalledTimes(1);
    expect(google).toHaveBeenCalledWith({ idToken: ID_TOKEN, audience: env.googleClientId });
    expect(await sessionRows(mongo.db)).toMatchObject([{ userId: GOOGLE_USER.id, email: GOOGLE_USER.email, usedAt: null }]);
    const me = await getMe(app, (response.body as { sessionToken: string }).sessionToken);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: GOOGLE_USER.id, firstName: 'Ada', lastName: 'Lovelace', pictureUrl: GOOGLE_USER.pictureUrl });
  });

  // Mocked behavior: Google's verifyIdToken accepts the token, for a verified account with no names and no photo
  // Input: { idToken }
  // Expected status code: 200
  // Expected behavior: the user is saved with empty names and no photo
  // Expected output: firstName and lastName '', and new tokens
  test('Google Account Without Names Or Photo', async () => {
    googleAccepts(anonymousPayload());

    const response = await postAuth(app, 'google', { idToken: ID_TOKEN });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ firstName: '', lastName: '', email: GOOGLE_USER.email });
    expect(await mongo.store.users.findById(GOOGLE_USER.id)).toMatchObject({ firstName: '', lastName: '', pictureUrl: null });
  });

  // Mocked behavior: Google's verifyIdToken accepts the token, for a verified account whose ticket has no email
  // Input: { idToken }
  // Expected status code: 200
  // Expected behavior: the user is saved with an empty email
  // Expected output: email '', and new tokens
  test('Google Account Without An Email', async () => {
    const { iss, aud, sub, iat, exp } = anonymousPayload();
    googleAccepts({ iss, aud, sub, iat, exp, email_verified: true });

    const response = await postAuth(app, 'google', { idToken: ID_TOKEN });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ email: '' });
  });

  // Mocked behavior: Google's verifyIdToken rejects the token (expired or forged), returns a ticket for an account
  // whose email is not verified, or returns a ticket with no payload
  // Input: { idToken }
  // Expected status code: 401
  // Expected behavior: no session is created and no user is saved
  // Expected output: { error: 'Invalid or expired Google ID token' }
  test.each([
    { label: 'Google Rejects The Token', install: () => mockGoogle().mockRejectedValue(new Error('Token used too late')) },
    { label: 'Email Not Verified', install: () => googleAccepts(googlePayload({ email_verified: false })) },
    { label: 'No Payload', install: () => googleAccepts(undefined) },
    { label: 'Google Rejects With A Non-Error Value', install: () => mockGoogle().mockRejectedValue('network down') },
  ])('$label: 401', async ({ install }: { label: string; install: () => jest.SpyInstance }) => {
    const google = install();

    const response = await postAuth(app, 'google', { idToken: ID_TOKEN });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Invalid or expired Google ID token' });
    expect(google).toHaveBeenCalledTimes(1);
    expect(await sessionRows(mongo.db)).toHaveLength(0);
    expect(await mongo.store.users.findById(GOOGLE_USER.id)).toBeNull();
  });

  // Mocked behavior: Google accepts the token, and sessions.insert rejects, as when MongoDB is unreachable
  // Input: { idToken }
  // Expected status code: 500
  // Expected behavior: the error is handled and no tokens are returned
  // Expected output: { error: 'Internal Server Error' }
  test('sessions.insert Throws: 500', async () => {
    googleAccepts(googlePayload());
    const spy = rejecting(mongo.store.sessions, 'insert');

    const response = await postAuth(app, 'google', { idToken: ID_TOKEN });

    expectServerError(response, spy);
  });

  // Mocked behavior: Google accepts the token, and users.upsertFromSignIn rejects
  // Input: { idToken }
  // Expected status code: 200
  // Expected behavior: the users collection only feeds names and photos to other features, so the sign-in still
  // succeeds and the refresh token is stored; the user is saved again at the next refresh
  // Expected output: new tokens; GET /api/users/me is 404 until then
  test('users.upsertFromSignIn Throws: Sign-In Still Succeeds', async () => {
    googleAccepts(googlePayload());
    const spy = rejecting(mongo.store.users, 'upsertFromSignIn');

    const response = await postAuth(app, 'google', { idToken: ID_TOKEN });

    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await sessionRows(mongo.db)).toHaveLength(1);
    expect((await getMe(app, (response.body as { sessionToken: string }).sessionToken)).status).toBe(404);
  });
});

interface StoreFailure {
  label: string;
  // Gets the refresh token to send, then makes the store method fail.
  arrange: (store: Store) => Promise<{ refreshToken: string; spy: jest.SpyInstance }>;
}

// A refresh token that was already exchanged once.
async function usedToken(store: Store): Promise<string> {
  const first = await signIn(store);
  await postAuth(app, 'refresh', { refreshToken: first.refreshToken });
  return first.refreshToken;
}

// Interface POST /api/auth/refresh
describe('Mocked: POST /api/auth/refresh', () => {
  // Mocked behavior: sessions.consume rejects for a valid token, sessions.find rejects for an unknown token,
  // sessions.revokeFamily rejects for a reused token, or sessions.insert rejects when saving the new token
  // Input: { refreshToken }
  // Expected status code: 500
  // Expected behavior: the error is handled and no tokens are returned
  // Expected output: { error: 'Internal Server Error' }
  test.each<StoreFailure>([
    {
      label: 'sessions.consume',
      arrange: async (store) => ({ refreshToken: (await signIn(store)).refreshToken, spy: rejecting(store.sessions, 'consume') }),
    },
    {
      label: 'sessions.find',
      arrange: () => Promise.resolve({ refreshToken: 'never-issued-token', spy: rejecting(mongo.store.sessions, 'find') }),
    },
    {
      label: 'sessions.revokeFamily',
      arrange: async (store) => ({ refreshToken: await usedToken(store), spy: rejecting(store.sessions, 'revokeFamily') }),
    },
    {
      label: 'sessions.insert',
      arrange: async (store) => ({ refreshToken: (await signIn(store)).refreshToken, spy: rejecting(store.sessions, 'insert') }),
    },
  ])('$label Throws: 500', async ({ arrange }: StoreFailure) => {
    const { refreshToken, spy } = await arrange(mongo.store);

    const response = await postAuth(app, 'refresh', { refreshToken });

    expectServerError(response, spy);
  });
});

// Interface POST /api/auth/logout
describe('Mocked: POST /api/auth/logout', () => {
  // Mocked behavior: sessions.find or sessions.revokeFamily rejects, as when MongoDB is unreachable
  // Input: { refreshToken } of a signed-in user
  // Expected status code: 500
  // Expected behavior: the error is handled, so the app knows the sign-out did not finish
  // Expected output: { error: 'Internal Server Error' }
  test.each<StoreFailure>([
    {
      label: 'sessions.find',
      arrange: async (store) => ({ refreshToken: (await signIn(store)).refreshToken, spy: rejecting(store.sessions, 'find') }),
    },
    {
      label: 'sessions.revokeFamily',
      arrange: async (store) => ({ refreshToken: (await signIn(store)).refreshToken, spy: rejecting(store.sessions, 'revokeFamily') }),
    },
  ])('$label Throws: 500', async ({ arrange }: StoreFailure) => {
    const { refreshToken, spy } = await arrange(mongo.store);

    const response = await postAuth(app, 'logout', { refreshToken });

    expectServerError(response, spy);
  });
});

// Interface GET /api/users/me, as a protected route
describe('Mocked: session token on protected routes', () => {
  // Mocked behavior: jwt.verify returns a plain string payload instead of claims
  // Input: GET /api/users/me with a bearer token
  // Expected status code: 401
  // Expected behavior: a payload without the user's claims is refused
  // Expected output: { error: 'Invalid or expired session token' }
  test('Token Payload Is A String: 401', async () => {
    const verify = jest.spyOn(jwt, 'verify').mockImplementation(() => 'not-claims');

    const response = await getMe(app, 'any-token');

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Invalid or expired session token' });
    expect(verify).toHaveBeenCalledTimes(1);
  });
});
