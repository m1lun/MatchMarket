import type { NextFunction, Request, Response } from 'express';

import { verifySessionToken, type SessionUser } from '../logic/sessions';

// Rejects the request with 401 unless it carries a valid session token in
// `Authorization: Bearer <token>`. On success the user is in res.locals; read
// it with currentUser(res). A 401 tells the app to call /api/auth/refresh.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const bearer = readBearerToken(req.get('authorization'));
  if (bearer === undefined) {
    res.status(401).json({ error: 'Missing Authorization: Bearer <session token> header' });
    return;
  }

  try {
    res.locals.user = verifySessionToken(bearer);
  } catch {
    res.status(401).json({ error: 'Invalid or expired session token' });
    return;
  }
  next();
}

// The signed-in user, for routes behind requireAuth.
export function currentUser(res: Response): SessionUser {
  return res.locals.user as SessionUser;
}

function readBearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }

  const [scheme, value] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || value === undefined || value === '') {
    return undefined;
  }

  return value;
}
