import { Router } from 'express';

import { currentUser } from '../../users/routes/requireAuth';
import { handle } from '../../../shared/http/handle';
import type { PostsService } from '../services/postsService';

export function createCustomFieldsRouter(posts: PostsService): Router {
  const router = Router();

  router.get('/', handle(async (_req, res) => {
    res.json(await posts.listCustomFields(currentUser(res).id));
  }));

  router.post('/', handle(async (req, res) => {
    res.status(201).json(await posts.addCustomField(currentUser(res).id, req.body));
  }));

  router.delete('/:key', handle(async (req, res) => {
    await posts.removeCustomField(currentUser(res).id, String(req.params.key));
    res.status(204).end();
  }));

  return router;
}
