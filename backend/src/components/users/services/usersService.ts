import { BadRequestError, NotFoundError } from '../../../shared/errors';
import { isObject, isText, parseLocation, type Body } from '../../../shared/http/checks';
import type { GeoPoint } from '../../../shared/models/common';
import type { PublicUser, User } from '../models/user';
import type { UserCollection } from '../store/types';

export type Place = { address: string; location: GeoPoint } | null;

// Only the address can be changed for now; names and email come from Google.
const EDITABLE_FIELDS = ['address', 'location'];

// The place to save, or null to clear it: both fields are set, or both are null.
function parsePlace(body: Body, errors: string[]): Place {
  if (body.address === null && body.location === null) {
    return null;
  }
  if (body.address === null || body.location === null) {
    errors.push('address and location must be set or cleared together');
    return null;
  }
  if (!isText(body.address)) {
    errors.push('address is required');
  }
  const location = parseLocation(body.location, errors);
  return { address: isText(body.address) ? body.address.trim() : '', location };
}

export class UsersService {
  constructor(private readonly users: UserCollection) {}

  async getMe(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (user === null) {
      throw new NotFoundError();
    }
    return user;
  }

  async updateAddress(userId: string, body: unknown): Promise<User> {
    if (!isObject(body)) {
      throw new BadRequestError(['request body must be a JSON object']);
    }
    const errors = Object.keys(body)
      .filter((name) => !EDITABLE_FIELDS.includes(name))
      .map((name) => `unsupported field "${name}"`);
    const place = parsePlace(body, errors);
    if (errors.length > 0) {
      throw new BadRequestError(errors);
    }
    const user = await this.users.updateAddress(userId, place);
    if (user === null) {
      throw new NotFoundError();
    }
    return user;
  }

  findPublicByIds(ids: string[]): Promise<PublicUser[]> {
    return this.users.findPublicByIds(ids);
  }
}
