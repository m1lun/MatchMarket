import { Router } from 'express';

import { currentUser } from '../../users/routes/requireAuth';
import { BadRequestError } from '../../../shared/errors';
import { isText } from '../../../shared/http/checks';
import { handle } from '../../../shared/http/handle';
import type { PostsService } from '../services/postsService';

export function createOptionsRouter(posts: PostsService): Router {
  const router = Router();

  router.get('/', handle(async (req, res) => {
    if (!isText(req.query.field)) {
      throw new BadRequestError(['field query parameter is required']);
    }
    res.json(await posts.listOptions(req.query.field));
  }));

  // Adds an option to a field's list; adding an existing option returns the existing one.
  router.post('/', handle(async (req, res) => {
    res.status(201).json(await posts.addOption(currentUser(res).id, req.body));
  }));

  return router;
}
