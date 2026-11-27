import { Router } from 'express';

import { currentUser } from '../../users/routes/requireAuth';
import { BadRequestError } from '../../../shared/errors';
import { MAX_LABEL_LENGTH } from '../../../shared/models/common';
import { isObject, isText } from '../../../shared/http/checks';
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
    const body = isObject(req.body) ? req.body : {};
    if (!isText(body.field) || !isText(body.label) || body.label.trim().length > MAX_LABEL_LENGTH) {
      throw new BadRequestError([`field and a label of 1 to ${MAX_LABEL_LENGTH} characters are required`]);
    }
    const option = await posts.addOption(body.field, body.label, currentUser(res).id);
    res.status(201).json(option);
  }));

  return router;
}
