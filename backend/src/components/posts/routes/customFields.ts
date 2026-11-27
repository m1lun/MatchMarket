import { Router } from 'express';

import { currentUser } from '../../users/routes/requireAuth';
import { BadRequestError } from '../../../shared/errors';
import { FIELD_TYPES, MAX_LABEL_LENGTH, RESERVED_KEYS, isOneOf, normaliseKey } from '../../../shared/models/common';
import { isObject, isText } from '../../../shared/http/checks';
import { handle } from '../../../shared/http/handle';
import type { PostsService } from '../services/postsService';

export function createCustomFieldsRouter(posts: PostsService): Router {
  const router = Router();

  router.get('/', handle(async (_req, res) => {
    res.json(await posts.listCustomFields(currentUser(res).id));
  }));

  router.post('/', handle(async (req, res) => {
    const body = isObject(req.body) ? req.body : {};
    const errors: string[] = [];
    const label = isText(body.label) ? body.label.trim() : '';
    const key = normaliseKey(label);
    if (label === '' || label.length > MAX_LABEL_LENGTH) {
      errors.push(`label must be 1 to ${MAX_LABEL_LENGTH} characters`);
    } else if (isOneOf(RESERVED_KEYS, key)) {
      errors.push(`"${label}" is already a built-in field, so there is no need to add it`);
    }
    const type = FIELD_TYPES.find((fieldType) => fieldType === body.type);
    if (type === undefined) {
      errors.push(`type must be one of: ${FIELD_TYPES.join(', ')}`);
    }
    if (errors.length > 0 || type === undefined) {
      throw new BadRequestError(errors);
    }
    res.status(201).json(await posts.addCustomField({ ownerId: currentUser(res).id, key, label, type }));
  }));

  router.delete('/:key', handle(async (req, res) => {
    await posts.removeCustomField(currentUser(res).id, String(req.params.key));
    res.status(204).end();
  }));

  return router;
}
