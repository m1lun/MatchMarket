import { date, object, text } from '../../../shared/models/schemaHelpers';
import { MAX_MESSAGE_LENGTH, MAX_NOTE_LENGTH, POST_KINDS, PROPOSAL_STATUSES } from './conversation';

const messageText = { bsonType: 'string', minLength: 1, maxLength: MAX_MESSAGE_LENGTH };

export const conversationSchema = object({
  listingId: { bsonType: ['string', 'null'] },
  requestId: { bsonType: ['string', 'null'] },
  sellerId: text(),
  buyerId: text(),
  postKind: { enum: [...POST_KINDS] },
  lastMessage: { anyOf: [{ bsonType: 'null' }, object({ senderId: text(), text: messageText, createdAt: date })] },
  proposal: object({
    proposerId: text(),
    price: { bsonType: 'number', minimum: 0 },
    note: { bsonType: 'string', maxLength: MAX_NOTE_LENGTH },
    status: { enum: [...PROPOSAL_STATUSES] },
    createdAt: date,
  }),
  createdAt: date,
  updatedAt: date,
}, ['proposal']);

export const messageSchema = object({
  conversationId: text(),
  senderId: text(),
  text: messageText,
  createdAt: date,
});
