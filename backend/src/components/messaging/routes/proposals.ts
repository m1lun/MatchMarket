import { Router } from 'express';

import { BadRequestError } from '../../../shared/errors';
import { MAX_NOTE_LENGTH } from '../models/conversation';
import { currentUser } from '../../users/routes/requireAuth';
import type { MessagingService } from '../services/messagingService';
import { isNumber } from '../../../shared/http/checks';
import { bodyFields } from './conversations';
import { handle } from '../../../shared/http/handle';

const PROPOSAL_FIELDS = ['price', 'note'];

function parseProposal(body: unknown): { price: number; note: string } {
  const { fields, errors } = bodyFields(body, PROPOSAL_FIELDS);
  const { price, note } = fields;
  if (!isNumber(price) || price < 0) {
    errors.push('price must be a number of at least 0');
  }
  if (note !== undefined && (typeof note !== 'string' || note.trim().length > MAX_NOTE_LENGTH)) {
    errors.push(`note must be text of at most ${MAX_NOTE_LENGTH} characters`);
  }
  if (errors.length > 0 || !isNumber(price)) {
    throw new BadRequestError(errors);
  }
  return { price, note: typeof note === 'string' ? note.trim() : '' };
}

export function createProposalsRouter(messaging: MessagingService): Router {
  const router = Router();

  // POST /api/conversations/:id/proposal — `{ price, note? }` proposes a price to the other participant.
  // 409 while a proposal is pending, or once one was accepted.
  router.post('/:id/proposal', handle(async (req, res) => {
    const { price, note } = parseProposal(req.body);
    res.status(201).json(await messaging.propose(currentUser(res).id, String(req.params.id), price, note));
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
