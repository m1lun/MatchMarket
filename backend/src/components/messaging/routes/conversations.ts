import { Router } from 'express';
import type { Request, Response } from 'express';

import { BadRequestError } from '../../../shared/errors';
import { MESSAGE_CREATED, type EventHub } from './events';
import { isOneOf } from '../../../shared/models/common';
import {
  DEFAULT_MESSAGES_PAGE,
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES_PAGE,
  POST_KINDS,
  isParticipant,
  otherParticipant,
  type Conversation,
  type PostKind,
} from '../models/conversation';
import type { PublicUser } from '../../users/models/user';
import { currentUser } from '../../users/routes/requireAuth';
import type { PostDoc } from '../../posts/store/types';
import type { Store } from '../../../shared/store/types';
import { isObject, type Body } from '../../../shared/http/checks';
import { handle } from '../../../shared/http/handle';
import { parsePageQuery, toPage } from './paging';

const POST_ID = /^[0-9a-f]{24}$/;
const OPEN_FIELDS = ['postId', 'postKind', 'myPostId'];
const MESSAGE_FIELDS = ['text'];
const MESSAGES_PAGE = { fallback: DEFAULT_MESSAGES_PAGE, max: MAX_MESSAGES_PAGE };

// The fields of a listing or request the conversations list shows. Posts saved before posts had names
// have no name, so they show their category, as the store's findById does.
interface PostView {
  id?: string;
  name?: string;
  category?: string;
  status?: string;
  photoIds?: string[];
}

interface Lookups {
  userOf: Map<string, PublicUser>;
  listingOf: Map<string, PostView>;
  requestOf: Map<string, PostView>;
}

export function bodyFields(body: unknown, allowed: string[]): { fields: Body; errors: string[] } {
  if (!isObject(body)) {
    return { fields: {}, errors: ['Request body must be a JSON object'] };
  }
  const errors = Object.keys(body)
    .filter((name) => !allowed.includes(name))
    .map((name) => `unsupported field "${name}"`);
  return { fields: body, errors };
}

interface OpenBody {
  postId: string;
  postKind: PostKind;
  myPostId: string | undefined;
}

function parseOpen(body: unknown): OpenBody {
  const { fields, errors } = bodyFields(body, OPEN_FIELDS);
  const postId = typeof fields.postId === 'string' && POST_ID.test(fields.postId) ? fields.postId : undefined;
  const postKind = typeof fields.postKind === 'string' && isOneOf(POST_KINDS, fields.postKind) ? fields.postKind : undefined;
  const myPostId = typeof fields.myPostId === 'string' && POST_ID.test(fields.myPostId) ? fields.myPostId : undefined;
  if (postId === undefined) {
    errors.push('postId must be the id of a listing or request');
  }
  if (postKind === undefined) {
    errors.push(`postKind must be one of: ${POST_KINDS.join(', ')}`);
  }
  if (fields.myPostId !== undefined && myPostId === undefined) {
    errors.push('myPostId must be the id of one of your posts');
  }
  if (errors.length > 0 || postId === undefined || postKind === undefined) {
    throw new BadRequestError(errors);
  }
  return { postId, postKind, myPostId };
}

function parseMessage(body: unknown): string {
  const { fields, errors } = bodyFields(body, MESSAGE_FIELDS);
  const text = typeof fields.text === 'string' ? fields.text.trim() : '';
  if (text === '' || text.length > MAX_MESSAGE_LENGTH) {
    errors.push(`text must be 1 to ${MAX_MESSAGE_LENGTH} characters`);
  }
  if (errors.length > 0) {
    throw new BadRequestError(errors);
  }
  return text;
}

function byId(items: PostView[]): Map<string, PostView> {
  return new Map(items.flatMap((item) => (item.id === undefined ? [] : [[item.id, item] as const])));
}

function present(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

function postView(id: string | null, posts: Map<string, PostView>) {
  const post = id === null ? undefined : posts.get(id);
  return post === undefined
    ? null
    : { id, name: post.name ?? post.category, status: post.status, photoId: post.photoIds?.[0] ?? null };
}

function conversationView(conversation: Conversation, me: string, lookups: Lookups) {
  const other = otherParticipant(conversation, me);
  return {
    id: conversation.id,
    postKind: conversation.postKind,
    listing: postView(conversation.listingId, lookups.listingOf),
    request: postView(conversation.requestId, lookups.requestOf),
    otherUser: lookups.userOf.get(other) ?? { id: other, firstName: '', lastName: '', pictureUrl: null },
    lastMessage: conversation.lastMessage,
    proposal: conversation.proposal ?? null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function findPost(store: Store, kind: PostKind, id: string): Promise<PostDoc | null> {
  return kind === 'listing' ? store.listings.findById(id) : store.requests.findById(id);
}

// Whether a post can start a conversation: someone else's open post, or with mine true, the caller's own
// open post. Sends the error itself when it can't.
function canUse(res: Response, post: PostDoc | null, mine: boolean): post is PostDoc {
  if (post === null) {
    res.status(404).json({ error: 'Not Found' });
    return false;
  }
  const isMine = post.ownerId === currentUser(res).id;
  if (mine && !isMine) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  if (!mine && isMine) {
    res.status(400).json({ error: 'Invalid request', details: ['you cannot start a conversation about your own post'] });
    return false;
  }
  if (post.status === 'closed') {
    res.status(409).json({ error: 'This post is closed' });
    return false;
  }
  return true;
}

// The tapped post is someone else's; myPostId, if any, is the caller's post of the other kind.
function dealParties(postKind: PostKind, post: PostDoc, me: string, myPostId: string | undefined) {
  const myPost = myPostId ?? null;
  return postKind === 'listing'
    ? { listingId: post.id, requestId: myPost, sellerId: post.ownerId, buyerId: me }
    : { listingId: myPost, requestId: post.id, sellerId: me, buyerId: post.ownerId };
}

// The caller's conversation. Sends the 404 or 403 itself and returns null when there is none.
export async function findMyConversation(store: Store, req: Request, res: Response): Promise<Conversation | null> {
  const conversation = await store.conversations.findById(String(req.params.id));
  if (conversation === null) {
    res.status(404).json({ error: 'Not Found' });
    return null;
  }
  if (!isParticipant(conversation, currentUser(res).id)) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return conversation;
}

export function createConversationsRouter(store: Store, events: EventHub): Router {
  const router = Router();

  // POST /api/conversations — `{ postId, postKind, myPostId? }` opens the caller's conversation with the owner of
  // the tapped post; myPostId is the caller's post it was recommended for. Returns the existing conversation
  // unchanged if there is one: 201 if it was created, 200 if it existed.
  router.post('/', handle(async (req, res) => {
    const { postId, postKind, myPostId } = parseOpen(req.body);
    const myKind = postKind === 'listing' ? 'request' : 'listing';
    const [post, myPost] = await Promise.all([
      findPost(store, postKind, postId),
      myPostId === undefined ? undefined : findPost(store, myKind, myPostId),
    ]);
    if (!canUse(res, post, false) || (myPost !== undefined && !canUse(res, myPost, true))) {
      return;
    }
    const now = new Date();
    const { conversation, created } = await store.conversations.open({
      ...dealParties(postKind, post, currentUser(res).id, myPostId),
      postKind,
      lastMessage: null,
      createdAt: now,
      updatedAt: now,
    });
    res.status(created ? 201 : 200).json(conversation);
  }));

  // GET /api/conversations — the caller's conversations, newest activity first, in at most 4 queries.
  router.get('/', handle(async (_req, res) => {
    const me = currentUser(res).id;
    const conversations = await store.conversations.listByUser(me);
    const others = [...new Set(conversations.map((c) => otherParticipant(c, me)))];
    const [users, listings, requests] = await Promise.all([
      store.users.findPublicByIds(others),
      store.listings.findByIds(present(conversations.map((c) => c.listingId)), ['name', 'category', 'status', 'photoIds'], true),
      store.requests.findByIds(present(conversations.map((c) => c.requestId)), ['name', 'category', 'status', 'photoIds'], true),
    ]);
    const lookups: Lookups = {
      userOf: new Map(users.map((user) => [user.id, user])),
      listingOf: byId(listings),
      requestOf: byId(requests),
    };
    res.json({ conversations: conversations.map((c) => conversationView(c, me, lookups)) });
  }));

  // GET /api/conversations/:id/messages?limit=30&before=<nextCursor> — newest first; nextCursor is null on the last page.
  router.get('/:id/messages', handle(async (req, res) => {
    const { limit, before } = parsePageQuery(req.query, MESSAGES_PAGE);
    const conversation = await findMyConversation(store, req, res);
    if (conversation === null) {
      return;
    }
    // One extra message tells whether another page follows.
    const found = await store.messages.listByConversation(conversation.id, limit + 1, before);
    const { page, nextCursor } = toPage(found, limit);
    res.json({ messages: page, nextCursor });
  }));

  // POST /api/conversations/:id/messages — `{ text }` sends a message from the caller.
  router.post('/:id/messages', handle(async (req, res) => {
    const text = parseMessage(req.body);
    const conversation = await findMyConversation(store, req, res);
    if (conversation === null) {
      return;
    }
    const senderId = currentUser(res).id;
    const createdAt = new Date();
    const message = await store.messages.insert({ conversationId: conversation.id, senderId, text, createdAt });
    await store.conversations.recordMessage(conversation.id, { senderId, text, createdAt });
    events.publish([otherParticipant(conversation, senderId)], MESSAGE_CREATED, message);
    res.status(201).json(message);
  }));

  return router;
}
