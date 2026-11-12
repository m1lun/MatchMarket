import { Router } from 'express';

import { currentUser } from '../sessions';
import { BadRequestError } from '../errors';
import { FIELD_TYPES, MAX_LABEL_LENGTH, RESERVED_KEYS, isOneOf, normaliseKey } from '../models/common';
import type { Store } from '../store/types';
import { isObject, isText } from './checks';
import { handle } from './handle';

export function createCustomFieldsRouter(store: Store): Router {
  const router = Router();

  router.get('/', handle(async (_req, res) => {
    res.json(await store.customFields.list(currentUser(res).id));
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
    const ownerId = currentUser(res).id;
    const existing = (await store.customFields.list(ownerId)).find((field) => field.key === key);
    if (existing !== undefined) {
      res.status(409).json({ error: `You already have a custom field called "${existing.label}"` });
      return;
    }
    res.status(201).json(await store.customFields.upsert({ ownerId, key, label, type }));
  }));

  router.delete('/:key', handle(async (req, res) => {
    const removed = await store.customFields.remove(currentUser(res).id, normaliseKey(String(req.params.key)));
    if (!removed) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    res.status(204).end();
  }));

  return router;
}
