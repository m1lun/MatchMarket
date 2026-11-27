import { Router } from 'express';

import { currentUser } from './requireAuth';
import type { UsersService } from '../services/usersService';
import { handle } from '../../../shared/http/handle';

export function createUsersRouter(users: UsersService): Router {
  const router = Router();

  // GET /api/users/me — the signed-in user's own profile, including the private fields.
  router.get('/me', handle(async (_req, res) => {
    res.json(await users.getMe(currentUser(res).id));
  }));

  // PATCH /api/users/me — `{ address, location: { longitude, latitude } }` sets the
  // profile address; `{ address: null, location: null }` clears it.
  router.patch('/me', handle(async (req, res) => {
    res.json(await users.updateAddress(currentUser(res).id, req.body));
  }));

  return router;
}
