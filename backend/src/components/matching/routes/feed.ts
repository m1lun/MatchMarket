import { Router, type RequestHandler } from 'express';

import { currentUser } from '../../users/routes/requireAuth';
import { BadRequestError, NotFoundError } from '../../../shared/errors';
import type { PostKind } from '../../posts/services/postsService';
import type { FeedService } from '../services/feedService';
import { FILTER_PARAMS, parsePostFilter } from './feedFilter';
import { handle } from '../../../shared/http/handle';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

// A post id is a MongoDB ObjectId: 24 hex characters.
const POST_ID = /^[0-9a-f]{24}$/;

// The query parameters GET /api/feed accepts. Any other is rejected rather than
// silently ignored, so a misspelt parameter is noticed.
const MATCH_FEED_PARAMS = ['postId', 'limit', 'cursor', ...FILTER_PARAMS];
const BROWSE_PARAMS = ['limit', 'before', ...FILTER_PARAMS];

function parseLimit(value: unknown, errors: string[]): number {
  if (value === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  const limit = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 0;
  if (limit < 1 || limit > MAX_PAGE_SIZE) {
    errors.push(`limit must be a whole number from 1 to ${MAX_PAGE_SIZE}`);
  }
  return limit;
}

function parseBefore(value: unknown, errors: string[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !POST_ID.test(value)) {
    errors.push('before must be the nextCursor from a previous page');
    return undefined;
  }
  return value;
}

function parsePostId(value: unknown, errors: string[]): string {
  if (typeof value !== 'string' || !POST_ID.test(value)) {
    errors.push('postId must be the id of one of your requests or listings');
    return '';
  }
  return value;
}

// The cursor is how many matches earlier pages returned. Clients treat it as opaque,
// so it can change form later without breaking them.
function parseCursor(value: unknown, errors: string[]): number {
  if (value === undefined) {
    return 0;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    errors.push('cursor must be the nextCursor from a previous page');
    return 0;
  }
  return Number(value);
}

// Responds with `{ [key]: posts, nextCursor }`: other users' open posts, newest first.
// nextCursor is the `before` for the next page, or null on the last page.
function browse(feed: FeedService, kind: PostKind, key: string): RequestHandler {
  return handle(async (req, res) => {
    const errors = Object.keys(req.query)
      .filter((name) => !BROWSE_PARAMS.includes(name))
      .map((name) => `unsupported parameter "${name}"`);
    const limit = parseLimit(req.query.limit, errors);
    const before = parseBefore(req.query.before, errors);
    const filter = parsePostFilter(req.query, errors);
    if (errors.length > 0) {
      throw new BadRequestError(errors);
    }
    const { page, nextCursor } = await feed.browse(kind, currentUser(res).id, limit, before, filter);
    res.json({ [key]: page, nextCursor });
  });
}

// Responds with one post, open or closed, to any signed-in user; 404 for a malformed or unknown id.
function one(feed: FeedService, kind: PostKind): RequestHandler {
  return handle(async (req, res) => {
    const id = String(req.params.id);
    if (!POST_ID.test(id)) {
      throw new NotFoundError();
    }
    res.json(await feed.one(kind, id));
  });
}

export function createFeedRouter(feed: FeedService): Router {
  const router = Router();

  // GET /api/feed?postId=<id>&limit=20&cursor=<nextCursor> — the ranked feed for one of
  // the caller's open posts: listings that match a request, or requests that match a
  // listing, best first, narrowed by any feed filters. The first page carries travel
  // times. nextCursor is the `cursor` for the next page, or null on the last page.
  router.get('/', handle(async (req, res) => {
    const errors = Object.keys(req.query)
      .filter((name) => !MATCH_FEED_PARAMS.includes(name))
      .map((name) => `unsupported parameter "${name}"`);
    const postId = parsePostId(req.query.postId, errors);
    const limit = parseLimit(req.query.limit, errors);
    const offset = parseCursor(req.query.cursor, errors);
    const filter = parsePostFilter(req.query, errors);
    if (errors.length > 0) {
      throw new BadRequestError(errors);
    }

    res.json(await feed.recommendations(currentUser(res).id, postId, limit, offset, filter));
  }));

  router.get('/listings', browse(feed, 'listing', 'listings'));
  router.get('/requests', browse(feed, 'request', 'requests'));
  router.get('/listings/:id', one(feed, 'listing'));
  router.get('/requests/:id', one(feed, 'request'));

  return router;
}
