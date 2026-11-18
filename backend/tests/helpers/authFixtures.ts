import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import type { Db } from 'mongodb';
import request from 'supertest';

import { createApp } from '../../src/app';
import type { GoogleUser } from '../../src/googleAuth';
import { SESSIONS_COLLECTION, type RefreshSession } from '../../src/models/session';
import { startSession, type AuthResponse } from '../../src/sessions';
import type { Store } from '../../src/store/types';

// The auth routes' body limit in src/app.ts.
export const AUTH_BODY_LIMIT = 4 * 1024;

export const GOOGLE_USER: GoogleUser = {
  id: 'google-sub-123',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  pictureUrl: 'https://lh3.googleusercontent.com/ada.jpg',
};

// The app as it runs in production: sessions in MongoDB rather than the in-memory repo of startTestApp.
export async function startAuthApp(store: Store): Promise<Server> {
  const server = createServer(createApp({ sessions: store.sessions, store }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

export async function clearAuthData(db: Db): Promise<void> {
  await Promise.all([db.collection(SESSIONS_COLLECTION).deleteMany({}), db.collection('users').deleteMany({})]);
}

// A sign-in that Google already vouched for, as POST /api/auth/google starts it.
export function signIn(store: Store, user: GoogleUser = GOOGLE_USER): Promise<AuthResponse> {
  return startSession(store.sessions, user, store.users);
}

export async function sessionRows(db: Db): Promise<RefreshSession[]> {
  const rows: unknown[] = await db.collection(SESSIONS_COLLECTION).find({}, { projection: { _id: 0 } }).toArray();
  return rows as RefreshSession[];
}

export function postAuth(app: Server, path: string, body: unknown): request.Test {
  return request(app).post(`/api/auth/${path}`).send(body as object);
}

// A raw body, for JSON that does not parse or is over the size limit.
export function postAuthRaw(app: Server, path: string, raw: string): request.Test {
  return request(app).post(`/api/auth/${path}`).set('Content-Type', 'application/json').send(raw);
}

export function getMe(app: Server, sessionToken: string): request.Test {
  return request(app).get('/api/users/me').set('Authorization', `Bearer ${sessionToken}`);
}
