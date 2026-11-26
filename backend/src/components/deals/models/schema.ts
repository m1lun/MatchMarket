import { MAX_COMMENT_LENGTH, MAX_STARS, MIN_STARS } from '../../../shared/models/common';
import { date, object, text } from '../../../shared/models/schemaHelpers';

export const dealSchema = object({
  listingId: { bsonType: ['string', 'null'] },
  requestId: { bsonType: ['string', 'null'] },
  sellerId: text(),
  buyerId: text(),
  agreedPrice: { bsonType: 'number', minimum: 0 },
  createdAt: date,
}, [], {
  // At least one of the two posts must be there.
  anyOf: [{ properties: { listingId: text() }, required: ['listingId'] }, { properties: { requestId: text() }, required: ['requestId'] }],
});

export const ratingSchema = object({
  dealId: text(),
  raterId: text(),
  ratedUserId: text(),
  stars: { bsonType: 'int', minimum: MIN_STARS, maximum: MAX_STARS },
  comment: { bsonType: 'string', maxLength: MAX_COMMENT_LENGTH },
  createdAt: date,
  updatedAt: date,
}, ['updatedAt']);

export const reputationSchema = object({
  userId: text(),
  starSum: { bsonType: 'number', minimum: 0 },
  ratingCount: { bsonType: 'number', minimum: 1 },
  updatedAt: date,
});
