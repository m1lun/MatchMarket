import { Router } from 'express';

import { BadRequestError } from '../../../shared/errors';
import { isOneOf } from '../../../shared/models/common';
import {
  DEFAULT_MESSAGES_PAGE,
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES_PAGE,
  POST_KINDS,
  type PostKind,
} from '../models/conversation';
import { currentUser } from '../../users/routes/requireAuth';
import type { MessagingService } from '../services/messagingService';
import { isObject, type Body } from '../../../shared/http/checks';
import { handle } from '../../../shared/http/handle';
import { parsePageQuery } from './paging';

const POST_ID = /^[0-9a-f]{24}$/;
const OPEN_FIELDS = ['postId', 'postKind', 'myPostId'];
const MESSAGE_FIELDS = ['text'];
const MESSAGES_PAGE = { fallback: DEFAULT_MESSAGES_PAGE, max: MAX_MESSAGES_PAGE };

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

export function createConversationsRouter(messaging: MessagingService): Router {
  const router = Router();

  // POST /api/conversations — `{ postId, postKind, myPostId? }` opens the caller's conversation with the owner of
  // the tapped post; myPostId is the caller's post it was recommended for. Returns the existing conversation
  // unchanged if there is one: 201 if it was created, 200 if it existed.
  router.post('/', handle(async (req, res) => {
    const { postId, postKind, myPostId } = parseOpen(req.body);
    const { conversation, created } = await messaging.open(currentUser(res).id, postId, postKind, myPostId);
    res.status(created ? 201 : 200).json(conversation);
  }));

  // GET /api/conversations — the caller's conversations, newest activity first, in at most 4 queries.
  router.get('/', handle(async (_req, res) => {
    res.json(await messaging.listInbox(currentUser(res).id));
  }));

  // GET /api/conversations/:id/messages?limit=30&before=<nextCursor> — newest first; nextCursor is null on the last page.
  router.get('/:id/messages', handle(async (req, res) => {
    const { limit, before } = parsePageQuery(req.query, MESSAGES_PAGE);
    res.json(await messaging.listMessages(currentUser(res).id, String(req.params.id), limit, before));
  }));

  // POST /api/conversations/:id/messages — `{ text }` sends a message from the caller.
  router.post('/:id/messages', handle(async (req, res) => {
    const text = parseMessage(req.body);
    res.status(201).json(await messaging.send(currentUser(res).id, String(req.params.id), text));
  }));

  return router;
}
