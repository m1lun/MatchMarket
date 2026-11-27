import type { Server } from 'node:http';

import jwt from 'jsonwebtoken';
import request from 'supertest';

import { SESSIONS_COLLECTION } from '../../src/components/users/models/session';
import { SESSION_TTL_SECONDS } from '../../src/components/users/services/sessionService';
import {
  AUTH_BODY_LIMIT,
  GOOGLE_USER,
  clearAuthData,
  getMe,
  postAuth,
  postAuthRaw,
  sessionRows,
  signIn,
  startAuthApp,
} from '../helpers/authFixtures';
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

interface BodyCase {
  label: string;
  body: unknown;
}

interface UnreadableCase {
  label: string;
  raw: string;
  status: number;
  expected: { error: string };
}

// Every auth route reads one token from a small JSON body, and refuses the request before using it in the same ways.
function unreadableBodyTests(path: string, field: string): void {
  // Input: POST /api/auth/<path> with no body, without <field>, or with <field> that is a number or only spaces
  // Expected status code: 400
  // Expected behavior: the request is refused before any session is read or created
  // Expected output: { error } naming the missing field
  test.each<BodyCase>([
    { label: 'No Body', body: undefined },
    { label: 'Missing Field', body: { other: 'value' } },
    { label: 'Number', body: { [field]: 42 } },
    { label: 'Only Spaces', body: { [field]: '   ' } },
  ])(`$label: 400`, async ({ body }: BodyCase) => {
    const response = await postAuth(app, path, body);

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: `Request body must contain a${field === 'idToken' ? 'n' : ''} ${field}` });
    expect(await sessionRows(mongo.db)).toHaveLength(0);
  });

  // Input: a body that is not valid JSON, and a body over the 4 KB limit
  // Expected status code: 400 for the JSON that does not parse, 413 for the oversized body
  // Expected behavior: the body is rejected before the route runs, so no session is read or created
  // Expected output: { error: 'Malformed request body' } or { error: 'Request body too large' }
  test.each<UnreadableCase>([
    { label: 'Malformed JSON', raw: `{"${field}": "abc`, status: 400, expected: { error: 'Malformed request body' } },
    {
      label: 'Body Over 4 KB',
      raw: JSON.stringify({ [field]: 'x'.repeat(AUTH_BODY_LIMIT) }),
      status: 413,
      expected: { error: 'Request body too large' },
    },
  ])('$label: $status', async ({ raw, status, expected }: UnreadableCase) => {
    const response = await postAuthRaw(app, path, raw);

    expect(response.status).toBe(status);
    expect(response.body).toStrictEqual(expected);
    expect(await sessionRows(mongo.db)).toHaveLength(0);
  });
}

// Interface POST /api/auth/google
describe('Unmocked: POST /api/auth/google', () => {
  unreadableBodyTests('google', 'idToken');

  // Input: an idToken that is not a token Google issued
  // Expected status code: 401
  // Expected behavior: Google's library rejects the token (it fetches Google's public keys first, and a failed fetch
  // also rejects), so no session is created and no user is saved
  // Expected output: { error: 'Invalid or expired Google ID token' }
  test('Token Google Rejects: 401', async () => {
    const response = await postAuth(app, 'google', { idToken: 'not-a-google-id-token' });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Invalid or expired Google ID token' });
    expect(await sessionRows(mongo.db)).toHaveLength(0);
    expect(await mongo.store.users.findById(GOOGLE_USER.id)).toBeNull();
  });
});

// Interface POST /api/auth/refresh
describe('Unmocked: POST /api/auth/refresh', () => {
  unreadableBodyTests('refresh', 'refreshToken');

  // Input: the refresh token from a sign-in
  // Expected status code: 200
  // Expected behavior: the token is marked used and a new token from the same sign-in is saved; the new session
  // token is accepted by a protected route
  // Expected output: the user's names and email, a new sessionToken and refreshToken, and sessionExpiresIn 900
  test('Valid Refresh Token', async () => {
    const first = await signIn(mongo.store);

    const response = await postAuth(app, 'refresh', { refreshToken: first.refreshToken });

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      firstName: GOOGLE_USER.firstName,
      lastName: GOOGLE_USER.lastName,
      email: GOOGLE_USER.email,
      sessionToken: expect.any(String) as string,
      sessionExpiresIn: SESSION_TTL_SECONDS,
      refreshToken: expect.any(String) as string,
    });
    const next = response.body as { sessionToken: string; refreshToken: string };
    expect(next.refreshToken).not.toBe(first.refreshToken);
    const rows = await sessionRows(mongo.db);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.familyId)).size).toBe(1);
    expect(rows.filter((row) => row.usedAt !== null)).toHaveLength(1);
    expect((await getMe(app, next.sessionToken)).status).toBe(200);
  });

  // Input: a refresh token from a sign-in that saved a profile photo
  // Expected status code: 200
  // Expected behavior: the user is saved again without changing the stored photo, since the session has no photo
  // Expected output: new tokens; GET /api/users/me still shows the photo
  test('Refresh Keeps The Stored Photo', async () => {
    const first = await signIn(mongo.store);

    const response = await postAuth(app, 'refresh', { refreshToken: first.refreshToken });

    expect(response.status).toBe(200);
    const me = await getMe(app, (response.body as { sessionToken: string }).sessionToken);
    expect(me.body).toMatchObject({ id: GOOGLE_USER.id, pictureUrl: GOOGLE_USER.pictureUrl });
  });

  // Input: a refresh token that was never issued
  // Expected status code: 401
  // Expected behavior: no session is created, and the user's existing sign-in is untouched
  // Expected output: { error: 'Invalid or expired refresh token' }
  test('Unknown Token: 401', async () => {
    const mine = await signIn(mongo.store);

    const response = await postAuth(app, 'refresh', { refreshToken: 'never-issued-token' });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Invalid or expired refresh token' });
    expect(await sessionRows(mongo.db)).toHaveLength(1);
    expect((await postAuth(app, 'refresh', { refreshToken: mine.refreshToken })).status).toBe(200);
  });

  // Input: a refresh token whose 30 days have passed
  // Expected status code: 401
  // Expected behavior: the expired token is not exchanged, so the user must sign in again
  // Expected output: { error: 'Invalid or expired refresh token' }
  test('Expired Token: 401', async () => {
    const first = await signIn(mongo.store);
    await mongo.db.collection(SESSIONS_COLLECTION).updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const response = await postAuth(app, 'refresh', { refreshToken: first.refreshToken });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error: 'Invalid or expired refresh token' });
    expect(await sessionRows(mongo.db)).toHaveLength(1);
  });

  // Input: a refresh token that was already exchanged, sent again (as by someone who stole it)
  // Expected status code: 401
  // Expected behavior: reuse means two parties hold the token, so every token from that sign-in is revoked,
  // including the one the first exchange issued; another sign-in of the same user is untouched
  // Expected output: { error: 'Invalid or expired refresh token' }, then 401 for the newer token too
  test('Reused Token Revokes The Whole Sign-In: 401', async () => {
    const first = await signIn(mongo.store);
    const otherDevice = await signIn(mongo.store);
    const rotated = await postAuth(app, 'refresh', { refreshToken: first.refreshToken });
    const newer = (rotated.body as { refreshToken: string }).refreshToken;

    const reuse = await postAuth(app, 'refresh', { refreshToken: first.refreshToken });
    const afterReuse = await postAuth(app, 'refresh', { refreshToken: newer });

    expect(rotated.status).toBe(200);
    expect(reuse.status).toBe(401);
    expect(reuse.body).toStrictEqual({ error: 'Invalid or expired refresh token' });
    expect(afterReuse.status).toBe(401);
    expect((await postAuth(app, 'refresh', { refreshToken: otherDevice.refreshToken })).status).toBe(200);
  });
});

// Interface POST /api/auth/logout
describe('Unmocked: POST /api/auth/logout', () => {
  unreadableBodyTests('logout', 'refreshToken');

  // Input: the current refresh token of a sign-in
  // Expected status code: 204
  // Expected behavior: every token from that sign-in is deleted, so the token can no longer be refreshed
  // Expected output: an empty body
  test('Signs Out', async () => {
    const mine = await signIn(mongo.store);

    const response = await postAuth(app, 'logout', { refreshToken: mine.refreshToken });

    expect(response.status).toBe(204);
    expect(response.body).toStrictEqual({});
    expect(await sessionRows(mongo.db)).toHaveLength(0);
    expect((await postAuth(app, 'refresh', { refreshToken: mine.refreshToken })).status).toBe(401);
  });

  // Input: an older, already exchanged refresh token of a sign-in
  // Expected status code: 204
  // Expected behavior: the whole sign-in ends, including its newest token
  // Expected output: an empty body; the newest token then gets 401 from /refresh
  test('Older Token Of The Sign-In Signs Out', async () => {
    const first = await signIn(mongo.store);
    const rotated = await postAuth(app, 'refresh', { refreshToken: first.refreshToken });
    const newest = (rotated.body as { refreshToken: string }).refreshToken;

    const response = await postAuth(app, 'logout', { refreshToken: first.refreshToken });

    expect(response.status).toBe(204);
    expect((await postAuth(app, 'refresh', { refreshToken: newest })).status).toBe(401);
  });

  // Input: a refresh token that was never issued, while the user is signed in on another device
  // Expected status code: 204
  // Expected behavior: signing out is idempotent, so nothing is deleted and the other sign-in still works
  // Expected output: an empty body
  test('Unknown Token Still Succeeds', async () => {
    const otherDevice = await signIn(mongo.store);

    const response = await postAuth(app, 'logout', { refreshToken: 'never-issued-token' });

    expect(response.status).toBe(204);
    expect(await sessionRows(mongo.db)).toHaveLength(1);
    expect((await postAuth(app, 'refresh', { refreshToken: otherDevice.refreshToken })).status).toBe(200);
  });
});

// Every route but /health and /api/auth reads the session token through requireAuth.
// Interface GET /api/users/me, as a protected route
describe('Unmocked: session token on protected routes', () => {
  // Input: GET /api/users/me with a session token from a sign-in
  // Expected status code: 200
  // Expected behavior: the token is accepted and identifies the signed-in user
  // Expected output: the user saved at sign-in
  test('Session Token From Sign-In Is Accepted', async () => {
    const mine = await signIn(mongo.store);

    const response = await getMe(app, mine.sessionToken);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: GOOGLE_USER.id, email: GOOGLE_USER.email, firstName: GOOGLE_USER.firstName });
  });

  // Input: GET /api/users/me with an Authorization header that is not "Bearer <token>", a session token that has
  // expired, one signed with another secret, one issued for another audience, and one without its email claim
  // Expected status code: 401
  // Expected behavior: the request is refused before the route reads the database
  // Expected output: { error } saying the header is missing or the token is invalid or expired
  test.each([
    { label: 'Basic Scheme', header: 'Basic dXNlcjpwYXNz', error: 'Missing Authorization: Bearer <session token> header' },
    { label: 'Bearer Without Token', header: 'Bearer ', error: 'Missing Authorization: Bearer <session token> header' },
    { label: 'Expired Token', header: `Bearer ${sessionToken({ expiresIn: -10 })}`, error: 'Invalid or expired session token' },
    { label: 'Wrong Secret', header: `Bearer ${sessionToken({}, 'another-secret-that-is-at-least-32-chars')}`, error: 'Invalid or expired session token' },
    { label: 'Wrong Audience', header: `Bearer ${sessionToken({ audience: 'another-app' })}`, error: 'Invalid or expired session token' },
    { label: 'No Email Claim', header: `Bearer ${sessionToken({}, undefined, {})}`, error: 'Invalid or expired session token' },
  ])('$label: 401', async ({ header, error }: { label: string; header: string; error: string }) => {
    await signIn(mongo.store);

    const response = await request(app).get('/api/users/me').set('Authorization', header);

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
  });
});

// A session token for GOOGLE_USER, signed as src/sessions.ts signs them unless an option is overridden.
function sessionToken(options: jwt.SignOptions, secret = process.env.JWT_SECRET ?? '', claims: object = { email: GOOGLE_USER.email }): string {
  return jwt.sign(claims, secret, {
    algorithm: 'HS256',
    subject: GOOGLE_USER.id,
    issuer: 'matchmarket-backend',
    audience: 'matchmarket-app',
    expiresIn: SESSION_TTL_SECONDS,
    ...options,
  });
}
