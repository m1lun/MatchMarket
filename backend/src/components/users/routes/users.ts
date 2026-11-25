import { Router } from 'express';

import { currentUser } from './requireAuth';
import { BadRequestError } from '../../../shared/errors';
import type { GeoPoint } from '../../../shared/models/common';
import type { Store } from '../../../shared/store/types';
import { isObject, isText, parseLocation, type Body } from '../../../shared/http/checks';
import { handle } from '../../../shared/http/handle';

// Only the address can be changed for now; names and email come from Google.
const EDITABLE_FIELDS = ['address', 'location'];

// The place to save, or null to clear it: both fields are set, or both are null.
function parsePlace(body: Body, errors: string[]): { address: string; location: GeoPoint } | null {
  if (body.address === null && body.location === null) {
    return null;
  }
  if (body.address === null || body.location === null) {
    errors.push('address and location must be set or cleared together');
    return null;
  }
  if (!isText(body.address)) {
    errors.push('address is required');
  }
  const location = parseLocation(body.location, errors);
  return { address: isText(body.address) ? body.address.trim() : '', location };
}

export function createUsersRouter(store: Store): Router {
  const router = Router();

  // GET /api/users/me — the signed-in user's own profile, including the private fields.
  router.get('/me', handle(async (_req, res) => {
    const user = await store.users.findById(currentUser(res).id);
    if (user === null) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    res.json(user);
  }));

  // PATCH /api/users/me — `{ address, location: { longitude, latitude } }` sets the
  // profile address; `{ address: null, location: null }` clears it.
  router.patch('/me', handle(async (req, res) => {
    const body: unknown = req.body;
    if (!isObject(body)) {
      throw new BadRequestError(['request body must be a JSON object']);
    }
    const errors = Object.keys(body)
      .filter((name) => !EDITABLE_FIELDS.includes(name))
      .map((name) => `unsupported field "${name}"`);
    const place = parsePlace(body, errors);
    if (errors.length > 0) {
      throw new BadRequestError(errors);
    }
    const user = await store.users.updateAddress(currentUser(res).id, place);
    if (user === null) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    res.json(user);
  }));

  return router;
}
