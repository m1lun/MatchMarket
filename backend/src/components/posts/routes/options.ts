import { Router } from 'express';

import { currentUser } from '../../users/routes/requireAuth';
import { BadRequestError } from '../../../shared/errors';
import { MAX_LABEL_LENGTH, normaliseKey } from '../../../shared/models/common';
import type { Store } from '../../../shared/store/types';
import { isObject, isText } from '../../../shared/http/checks';
import { handle } from '../../../shared/http/handle';
import { newOption } from '../logic/remember';

export function createOptionsRouter(store: Store): Router {
  const router = Router();

  router.get('/', handle(async (req, res) => {
    if (!isText(req.query.field)) {
      throw new BadRequestError(['field query parameter is required']);
    }
    res.json(await store.options.list(normaliseKey(req.query.field)));
  }));

  // Adds an option to a field's list; adding an existing option returns the existing one.
  router.post('/', handle(async (req, res) => {
    const body = isObject(req.body) ? req.body : {};
    if (!isText(body.field) || !isText(body.label) || body.label.trim().length > MAX_LABEL_LENGTH) {
      throw new BadRequestError([`field and a label of 1 to ${MAX_LABEL_LENGTH} characters are required`]);
    }
    const option = await store.options.ensure(newOption(body.field, body.label, currentUser(res).id));
    res.status(201).json(option);
  }));

  return router;
}
