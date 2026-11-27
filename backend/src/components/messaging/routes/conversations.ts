import { Router } from 'express';

import { DEFAULT_MESSAGES_PAGE, MAX_MESSAGES_PAGE } from '../models/conversation';
import { currentUser } from '../../users/routes/requireAuth';
import type { MessagingService } from '../services/messagingService';
import { handle } from '../../../shared/http/handle';
import { parsePageQuery } from './paging';

const MESSAGES_PAGE = { fallback: DEFAULT_MESSAGES_PAGE, max: MAX_MESSAGES_PAGE };

export function createConversationsRouter(messaging: MessagingService): Router {
  const router = Router();

  // POST /api/conversations — `{ postId, postKind, myPostId? }` opens the caller's conversation with the owner of
  // the tapped post; myPostId is the caller's post it was recommended for. Returns the existing conversation
  // unchanged if there is one: 201 if it was created, 200 if it existed.
  router.post('/', handle(async (req, res) => {
    const { conversation, created } = await messaging.open(currentUser(res).id, req.body);
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
    res.status(201).json(await messaging.send(currentUser(res).id, String(req.params.id), req.body));
  }));

  return router;
}
