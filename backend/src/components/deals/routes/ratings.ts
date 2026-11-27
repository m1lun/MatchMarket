import { Router } from 'express';
import type { ErrorRequestHandler } from 'express';

import { BadRequestError } from '../../../shared/errors';
import { MAX_COMMENT_LENGTH, MAX_STARS, MIN_STARS } from '../../../shared/models/common';
import { currentUser } from '../../users/routes/requireAuth';
import type { DealsService } from '../services/dealsService';
import { isObject } from '../../../shared/http/checks';
import { handle } from '../../../shared/http/handle';

const RATING_FIELDS = ['stars', 'comment'];

function parseRating(body: unknown): { stars: number; comment: string } {
  const errors: string[] = [];
  const fields = isObject(body) ? body : {};
  if (!isObject(body)) {
    errors.push('Request body must be a JSON object');
  }
  for (const name of Object.keys(fields)) {
    if (!RATING_FIELDS.includes(name)) {
      errors.push(`unsupported field "${name}"`);
    }
  }
  const { stars } = fields;
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < MIN_STARS || stars > MAX_STARS) {
    errors.push(`stars must be a whole number from ${MIN_STARS} to ${MAX_STARS}`);
  }
  let comment = '';
  if (fields.comment !== undefined) {
    if (typeof fields.comment === 'string' && fields.comment.trim().length <= MAX_COMMENT_LENGTH) {
      comment = fields.comment.trim();
    } else {
      errors.push(`comment must be text of at most ${MAX_COMMENT_LENGTH} characters`);
    }
  }
  if (errors.length > 0 || typeof stars !== 'number') {
    throw new BadRequestError(errors);
  }
  return { stars, comment };
}

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
    const rating = parseRating(req.body);
    res.status(201).json(await deals.rate(String(req.params.id), currentUser(res).id, rating));
  }));

  // PUT /api/deals/:id/ratings — the caller replaces their rating of the deal and gets back the other party's new score.
  router.put('/:id/ratings', handle(async (req, res) => {
    const rating = parseRating(req.body);
    res.json(await deals.editRating(String(req.params.id), currentUser(res).id, rating));
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
