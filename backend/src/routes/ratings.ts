import { Router } from 'express';
import type { ErrorRequestHandler, Request, Response } from 'express';

import { BadRequestError } from '../errors';
import { MAX_COMMENT_LENGTH, MAX_STARS, MIN_STARS } from '../models/common';
import { otherParty } from '../models/deal';
import type { Rating } from '../models/rating';
import type { Reputation } from '../models/reputation';
import { reputationSummary } from '../reputation/score';
import { currentUser } from '../sessions';
import type { Store } from '../store/types';
import { isObject } from './checks';
import { handle } from './handle';

// MongoDB's code for an insert that breaks a unique index.
const DUPLICATE_KEY = 11000;

class AlreadyRatedError extends Error {}

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

// The caller's deal and the other party in it. Sends the 404 or 403 itself and returns null when there is none.
async function findMyDeal(
  store: Store,
  req: Request,
  res: Response,
): Promise<{ dealId: string; me: string; ratedUserId: string } | null> {
  const me = currentUser(res).id;
  const deal = await store.deals.findById(String(req.params.id));
  if (deal === null) {
    res.status(404).json({ error: 'Not Found' });
    return null;
  }
  if (deal.sellerId !== me && deal.buyerId !== me) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return { dealId: deal.id, me, ratedUserId: otherParty(deal, me) };
}

export function createRatingsRouter(store: Store): Router {
  const router = Router();

  // POST /api/deals/:id/ratings — the caller rates the other party of their deal and gets back that party's new score.
  router.post('/:id/ratings', handle(async (req, res) => {
    const { stars, comment } = parseRating(req.body);
    const myDeal = await findMyDeal(store, req, res);
    if (myDeal === null) {
      return;
    }
    const { dealId, me, ratedUserId } = myDeal;
    const now = new Date();

    let saved: { rating: Rating; reputation: Reputation };
    try {
      saved = await store.transaction(async (tx) => {
        let rating: Rating;
        try {
          rating = await tx.ratings.insert({ dealId, raterId: me, ratedUserId, stars, comment, createdAt: now });
        } catch (error) {
          throw (error as { code?: number }).code === DUPLICATE_KEY ? new AlreadyRatedError() : error;
        }
        const reputation = await tx.reputations.addRating(ratedUserId, stars, now);
        return { rating, reputation };
      });
    } catch (error) {
      if (error instanceof AlreadyRatedError) {
        res.status(409).json({ error: 'You already rated this deal' });
        return;
      }
      throw error;
    }
    res.status(201).json({ rating: saved.rating, otherUser: reputationSummary(ratedUserId, saved.reputation) });
  }));

  // PUT /api/deals/:id/ratings — the caller replaces their rating of the deal and gets back the other party's new score.
  router.put('/:id/ratings', handle(async (req, res) => {
    const { stars, comment } = parseRating(req.body);
    const myDeal = await findMyDeal(store, req, res);
    if (myDeal === null) {
      return;
    }
    const { dealId, me, ratedUserId } = myDeal;
    const now = new Date();

    const saved = await store.transaction(async (tx) => {
      const updated = await tx.ratings.update(dealId, me, stars, comment, now);
      if (updated === null) {
        return null;
      }
      const delta = stars - updated.previousStars;
      const reputation = delta === 0 ? await tx.reputations.find(ratedUserId) : await tx.reputations.changeStars(ratedUserId, delta, now);
      return { rating: updated.rating, reputation };
    });
    if (saved === null) {
      res.status(404).json({ error: 'You have not rated this deal' });
      return;
    }
    res.json({ rating: saved.rating, otherUser: reputationSummary(ratedUserId, saved.reputation) });
  }));

  return router;
}

export function createReputationRouter(store: Store): Router {
  const router = Router();

  // GET /api/users/:id/reputation — a user's score and rating count; score is null when nobody has rated them.
  router.get('/:id/reputation', handle(async (req, res) => {
    const userId = String(req.params.id);
    const { id, score, ratingCount } = reputationSummary(userId, await store.reputations.find(userId));
    res.json({ userId: id, score, ratingCount });
  }));

  return router;
}
