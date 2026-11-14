import type { Db } from 'mongodb';
import request from 'supertest';

import type { Conversation, Message } from '../../src/models/conversation';
import type { Store } from '../../src/store/types';
import { ME, OTHER, STRANGER, bearer, makeListing } from './dealFixtures';

type App = Parameters<typeof request>[0];

interface CallOptions {
  userId?: string | undefined;
  auth?: string | null | undefined;
  type?: string | undefined;
}

export interface TokenCase { label: string; auth: string | null; error: string }

// A request a conversation route must refuse before reading or changing anything. `id` replaces the conversation's id.
export interface AccessCase { label: string; status: number; error: string; userId?: string; auth?: string | null; id?: string }

// A body a route must refuse; `status` and `expected` are the response it must give.
export interface BodyCase { label: string; raw: string; type?: string; status: number; expected: unknown }

export const UNKNOWN_ID = '6ad40b88e74dd3678bfef8f3';
export const BODY_ERROR = 'Request body must be a JSON object';
export const BODY_LIMIT = 16 * 1024;

export const TOKEN_CASES: TokenCase[] = [
  { label: 'No Token', auth: null, error: 'Missing Authorization: Bearer <session token> header' },
  { label: 'Garbage Token', auth: 'Bearer not-a-token', error: 'Invalid or expired session token' },
];

export const ACCESS_CASES: AccessCase[] = [
  { label: 'Not A Participant', status: 403, error: 'Forbidden', userId: STRANGER },
  { label: 'Unknown Conversation', status: 404, error: 'Not Found', id: UNKNOWN_ID },
  { label: 'Malformed Id', status: 404, error: 'Not Found', id: 'nope' },
  ...TOKEN_CASES.map(({ label, auth, error }) => ({ label, status: 401, error, auth })),
];

export function invalid(details: string[]): Pick<BodyCase, 'status' | 'expected'> {
  return { status: 400, expected: { error: 'Invalid request', details } };
}

// JSON cut off halfway, and a valid `body` padded with spaces to one byte over the 16 KB limit.
export function unreadableBodies(body: unknown): BodyCase[] {
  return [
    { label: 'Malformed JSON', raw: JSON.stringify(body).slice(0, -1), status: 400, expected: { error: 'Malformed request body' } },
    { label: 'Body Over 16 KB', raw: paddedBody(body, BODY_LIMIT + 1), status: 413, expected: { error: 'Request body too large' } },
  ];
}

function withAuth(sent: request.Test, options: CallOptions): request.Test {
  const auth = options.auth === undefined ? bearer(options.userId ?? ME) : options.auth;
  return auth === null ? sent : sent.set('Authorization', auth);
}

export function get(app: App, url: string, options: CallOptions = {}): request.Test {
  return withAuth(request(app).get(url), options);
}

export function postRaw(app: App, url: string, raw: string, options: CallOptions = {}): request.Test {
  return withAuth(request(app).post(url), options)
    .set('Content-Type', options.type ?? 'application/json')
    .send(raw);
}

export function post(app: App, url: string, body: unknown, options: CallOptions = {}): request.Test {
  return postRaw(app, url, JSON.stringify(body), options);
}

function paddedBody(body: unknown, bytes: number): string {
  const json = JSON.stringify(body);
  return json + ' '.repeat(bytes - json.length);
}

type ConversationParts = Pick<Conversation, 'sellerId' | 'buyerId' | 'postKind'> & { listingId?: string; requestId?: string };

export function makeConversation(store: Store, parts: ConversationParts): Promise<Conversation> {
  const now = new Date();
  const { listingId, requestId, ...rest } = parts;
  return store.conversations
    .open({ ...rest, listingId: listingId ?? null, requestId: requestId ?? null, lastMessage: null, createdAt: now, updatedAt: now })
    .then(({ conversation }) => conversation);
}

// OTHER's listing, with a conversation ME started about it.
export async function makeListingConversation(store: Store): Promise<Conversation> {
  const listing = await makeListing(store, OTHER);
  return makeConversation(store, { listingId: listing.id, sellerId: OTHER, buyerId: ME, postKind: 'listing' });
}

// Sends through the store as the route does, so the conversation's lastMessage follows.
export async function makeMessage(store: Store, conversationId: string, senderId: string, text: string): Promise<Message> {
  const createdAt = new Date();
  const message = await store.messages.insert({ conversationId, senderId, text, createdAt });
  await store.conversations.recordMessage(conversationId, { senderId, text, createdAt });
  return message;
}

const CONVERSATION_COLLECTIONS = ['conversations', 'messages', 'listings', 'requests', 'users'];

export async function clearConversationData(db: Db): Promise<void> {
  await Promise.all(
    CONVERSATION_COLLECTIONS.map(async (name) => {
      await db.collection(name).deleteMany({});
    })
  );
}

export async function storedConversations(db: Db): Promise<unknown[]> {
  const found: unknown[] = await db.collection('conversations').find().sort({ _id: 1 }).toArray();
  return found;
}

export async function storedMessages(db: Db): Promise<unknown[]> {
  const found: unknown[] = await db.collection('messages').find().sort({ _id: 1 }).toArray();
  return found;
}

export async function storedData(db: Db): Promise<unknown> {
  return { conversations: await storedConversations(db), messages: await storedMessages(db) };
}
