import type { Router } from 'express';

import { CONDITIONS, isOneOf } from '../../../shared/models/common';
import type { BuyerRequest } from '../models/request';
import type { Store } from '../../../shared/store/types';
import { createPostRouter } from './posts';

export function createRequestsRouter(store: Store): Router {
  return createPostRouter<BuyerRequest>(store, {
    collection: store.requests,
    builtins: {
      price: { label: 'Max price', type: 'number' },
      condition: { label: 'Min condition', type: 'text' },
      dimensions: { label: 'Max size', type: 'dimensions' },
      radiuskm: { label: 'Radius (km)', type: 'number' },
      brand: { label: 'Brand', type: 'text' },
      colour: { label: 'Colour', type: 'text' },
    },
    fieldsKey: 'requestFields',
    minPhotos: 0,
    parseExtra(_body, fields, errors) {
      if (!fields.some((field) => field.kind === 'builtin' && field.key === 'price')) {
        errors.push('a max price is required');
      }
      const condition = fields.find((field) => field.kind === 'builtin' && field.key === 'condition');
      if (
        condition !== undefined &&
        (typeof condition.value !== 'string' || !isOneOf(CONDITIONS, condition.value))
      ) {
        errors.push(`min condition must be one of: ${CONDITIONS.join(', ')}`);
      }
      return {};
    },
  });
}
