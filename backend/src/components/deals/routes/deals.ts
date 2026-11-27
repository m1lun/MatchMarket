import { Router } from 'express';

import { BadRequestError } from '../../../shared/errors';
import { DEFAULT_DEALS_PAGE, MAX_DEALS_PAGE } from '../../../shared/models/common';
import { currentUser } from '../../users/routes/requireAuth';
import type { DealsService } from '../services/dealsService';
import { isObject } from '../../../shared/http/checks';
import { handle } from '../../../shared/http/handle';

const DEAL_ID = /^[0-9a-f]{24}$/;
const DEALS_PARAMS = ['limit', 'before'];

function parseLimit(value: unknown, errors: string[]): number {
  if (value === undefined) {
    return DEFAULT_DEALS_PAGE;
  }
  const limit = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 0;
  if (limit < 1 || limit > MAX_DEALS_PAGE) {
    errors.push(`limit must be a whole number from 1 to ${MAX_DEALS_PAGE}`);
  }
  return limit;
}

function parseBefore(value: unknown, errors: string[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !DEAL_ID.test(value)) {
    errors.push('before must be the nextCursor from a previous page');
    return undefined;
  }
  return value;
}

function parseDealsQuery(query: unknown): { limit: number; before: string | undefined } {
  const params = isObject(query) ? query : {};
  const errors = Object.keys(params)
    .filter((name) => !DEALS_PARAMS.includes(name))
    .map((name) => `unsupported parameter "${name}"`);
  const limit = parseLimit(params.limit, errors);
  const before = parseBefore(params.before, errors);
  if (errors.length > 0) {
    throw new BadRequestError(errors);
  }
  return { limit, before };
}

export function createDealsRouter(deals: DealsService): Router {
  const router = Router();

  // GET /api/deals?limit=20&before=<nextCursor> — the caller's deals, newest first.
  // At most 6 queries however many deals there are; nextCursor is null on the last page.
  router.get('/', handle(async (req, res) => {
    const { limit, before } = parseDealsQuery(req.query);
    res.json(await deals.listMine(currentUser(res).id, limit, before));
  }));

  return router;
}
