import { MAX_ADDRESS_LENGTH } from '../../../shared/models/common';
import { date, location, object, text } from '../../../shared/models/schemaHelpers';

// Names may be empty: Google doesn't always send a family name.
export const userSchema = object(
  {
    id: text(),
    firstName: { bsonType: 'string' },
    lastName: { bsonType: 'string' },
    email: { bsonType: 'string' },
    pictureUrl: { bsonType: ['string', 'null'] },
    address: text(MAX_ADDRESS_LENGTH),
    location,
    createdAt: date,
    updatedAt: date,
  },
  ['address', 'location'],
  { dependencies: { address: ['location'], location: ['address'] } },
);

export const sessionSchema = object({
  tokenHash: { bsonType: 'string', pattern: '^[0-9a-f]{64}$' },
  familyId: text(),
  userId: text(),
  email: { bsonType: 'string' },
  firstName: { bsonType: 'string' },
  lastName: { bsonType: 'string' },
  createdAt: date,
  expiresAt: date,
  usedAt: { bsonType: ['date', 'null'] },
});
