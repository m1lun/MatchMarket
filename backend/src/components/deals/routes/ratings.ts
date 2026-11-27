import { Router } from 'express';
import type { ErrorRequestHandler } from 'express';

import { currentUser } from '../../users/routes/requireAuth';
import type { DealsService } from '../services/dealsService';
import { handle } from '../../../shared/http/handle';

// A rating body over the size limit is the client's mistake, so it gets a 413 rather than the generic 500.
export const ratingBodyTooLarge: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if ((error as { status?: number }).status === 413) {
    res.status(413).json({ error: 'Request body too large' });
    return;
  }
  next(error);
};

export function createRatingsRouter(deals: DealsService): Router {
  const router = Router();

  // POST /api/deals/:id/ratings — the caller rates the other party of their deal and gets back that party's new score.
  router.post('/:id/ratings', handle(async (req, res) => {
    res.status(201).json(await deals.rate(String(req.params.id), currentUser(res).id, req.body));
  }));

  // PUT /api/deals/:id/ratings — the caller replaces their rating of the deal and gets back the other party's new score.
  router.put('/:id/ratings', handle(async (req, res) => {
    res.json(await deals.editRating(String(req.params.id), currentUser(res).id, req.body));
  }));

  return router;
}

export function createReputationRouter(deals: DealsService): Router {
  const router = Router();

  // GET /api/users/:id/reputation — a user's score and rating count; score is null when nobody has rated them.
  router.get('/:id/reputation', handle(async (req, res) => {
    res.json(await deals.reputation(String(req.params.id)));
  }));

  return router;
}
