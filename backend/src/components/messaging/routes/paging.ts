import { BadRequestError } from '../../../shared/errors';
import type { Body } from '../../../shared/http/checks';

const OBJECT_ID = /^[0-9a-f]{24}$/;
const PAGE_PARAMS = ['limit', 'before'];

export interface PageQuery {
  limit: number;
  before: string | undefined;
}

export interface PageSize {
  fallback: number;
  max: number;
}

function parseLimit(value: unknown, size: PageSize, errors: string[]): number {
  if (value === undefined) {
    return size.fallback;
  }
  const limit = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 0;
  if (limit < 1 || limit > size.max) {
    errors.push(`limit must be a whole number from 1 to ${size.max}`);
  }
  return limit;
}

function parseBefore(value: unknown, errors: string[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) {
    errors.push('before must be the nextCursor from a previous page');
    return undefined;
  }
  return value;
}

// `?limit=&before=` for a list paged newest first by id; any other parameter is rejected.
export function parsePageQuery(params: Body, size: PageSize): PageQuery {
  const errors = Object.keys(params)
    .filter((name) => !PAGE_PARAMS.includes(name))
    .map((name) => `unsupported parameter "${name}"`);
  const limit = parseLimit(params.limit, size, errors);
  const before = parseBefore(params.before, errors);
  if (errors.length > 0) {
    throw new BadRequestError(errors);
  }
  return { limit, before };
}
