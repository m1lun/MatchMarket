import type { Db } from 'mongodb';
import request from 'supertest';

import type { Conversation, Message, Proposal } from '../../src/models/conversation';
import type { Store } from '../../src/store/types';
import { ME, OTHER, bearer, makeListing } from './dealFixtures';

type App = Parameters<typeof request>[0];

interface CallOptions {
  userId?: string;
  auth?: string | null;
  type?: string;
}

export interface TokenCase { label: string; auth: string | null; error: string }
export interface IdCase { label: string; id: string }

export const UNKNOWN_ID = '6ad40b88e74dd3678bfef8f3';
export const BODY_ERROR = 'Request body must be a JSON object';
export const BODY_LIMIT = 16 * 1024;

export const TOKEN_CASES: TokenCase[] = [
  { label: 'No Token', auth: null, error: 'Missing Authorization: Bearer <session token> header' },
  { label: 'Garbage Token', auth: 'Bearer not-a-token', error: 'Invalid or expired session token' },
];

export const UNKNOWN_IDS: IdCase[] = [
  { label: 'Unknown Conversation', id: UNKNOWN_ID },
  { label: 'Malformed Id', id: 'nope' },
];

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

// A JSON body padded with spaces to exactly `bytes` bytes.
export function paddedBody(body: unknown, bytes: number): string {
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

export async function makeProposal(store: Store, conversationId: string, proposerId: string, price = 35): Promise<Proposal> {
  const proposal: Proposal = { proposerId, price, note: '', status: 'pending', createdAt: new Date() };
  await store.conversations.propose(conversationId, proposal);
  return proposal;
}

const CONVERSATION_COLLECTIONS = ['conversations', 'messages', 'listings', 'requests', 'users', 'deals'];

export async function clearConversationData(db: Db): Promise<void> {
  await Promise.all(
    CONVERSATION_COLLECTIONS.map(async (name) => {
      await db.collection(name).deleteMany({});
    })
  );
}

export async function storedConversations(db: Db): Promise<unknown[]> {
  return db.collection('conversations').find().sort({ _id: 1 }).toArray();
}

export async function storedMessages(db: Db): Promise<unknown[]> {
  return db.collection('messages').find().sort({ _id: 1 }).toArray();
}

export async function storedData(db: Db): Promise<unknown> {
  return { conversations: await storedConversations(db), messages: await storedMessages(db) };
}
