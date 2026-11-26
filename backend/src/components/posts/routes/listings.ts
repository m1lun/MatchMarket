import type { Router } from 'express';

import { CONDITIONS, isOneOf } from '../../../shared/models/common';
import type { Listing } from '../models/listing';
import type { Store } from '../../../shared/store/types';
import { isNumber } from '../../../shared/http/checks';
import { createPostRouter } from './posts';

export function createListingsRouter(store: Store): Router {
  return createPostRouter<Listing>(store, {
    collection: store.listings,
    builtins: {
      brand: { label: 'Brand', type: 'text' },
      colour: { label: 'Colour', type: 'text' },
      dimensions: { label: 'Size', type: 'dimensions' },
    },
    fieldsKey: 'listingFields',
    minPhotos: 1,
    parseExtra(body, _fields, errors) {
      if (!isNumber(body.price) || body.price < 0) {
        errors.push('price must be a number of at least 0');
      }
      if (typeof body.condition !== 'string' || !isOneOf(CONDITIONS, body.condition)) {
        errors.push(`condition must be one of: ${CONDITIONS.join(', ')}`);
      }
      return { price: body.price, condition: body.condition };
    },
  });
}
