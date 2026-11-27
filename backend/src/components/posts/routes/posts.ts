import { Router } from 'express';

import { currentUser } from '../../users/routes/requireAuth';
import { handle } from '../../../shared/http/handle';
import type { PostKind, PostsService } from '../services/postsService';

export function createPostRouter(posts: PostsService, kind: PostKind): Router {
  const router = Router();

  router.post('/', handle(async (req, res) => {
    res.status(201).json(await posts.create(kind, currentUser(res).id, req.body));
  }));

  router.get('/', handle(async (_req, res) => {
    res.json(await posts.listMine(kind, currentUser(res).id));
  }));

  router.get('/:id', handle(async (req, res) => {
    res.json(await posts.getMine(kind, currentUser(res).id, String(req.params.id)));
  }));

  router.patch('/:id', handle(async (req, res) => {
    res.json(await posts.update(kind, currentUser(res).id, String(req.params.id), req.body));
  }));

  router.delete('/:id', handle(async (req, res) => {
    await posts.remove(kind, currentUser(res).id, String(req.params.id));
    res.status(204).end();
  }));

  return router;
}
