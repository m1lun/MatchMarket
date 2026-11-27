import { Router } from 'express';

import { currentUser } from '../../users/routes/requireAuth';
import type { MessagingService } from '../services/messagingService';
import { handle } from '../../../shared/http/handle';

export function createProposalsRouter(messaging: MessagingService): Router {
  const router = Router();

  // POST /api/conversations/:id/proposal — `{ price, note? }` proposes a price to the other participant.
  // 409 while a proposal is pending, or once one was accepted.
  router.post('/:id/proposal', handle(async (req, res) => {
    res.status(201).json(await messaging.propose(currentUser(res).id, String(req.params.id), req.body));
  }));

  // POST /api/conversations/:id/proposal/accept — makes the deal from the conversation's posts and people
  // at the proposed price, and closes the posts. Retrying after a failure finishes the same deal.
  router.post('/:id/proposal/accept', handle(async (req, res) => {
    res.status(201).json(await messaging.accept(currentUser(res).id, String(req.params.id)));
  }));

  // POST /api/conversations/:id/proposal/decline — turns down the pending proposal; either side can then propose again.
  router.post('/:id/proposal/decline', handle(async (req, res) => {
    res.json(await messaging.decline(currentUser(res).id, String(req.params.id)));
  }));

  return router;
}
