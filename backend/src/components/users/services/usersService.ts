import { NotFoundError } from '../../../shared/errors';
import type { GeoPoint } from '../../../shared/models/common';
import type { PublicUser, User } from '../models/user';
import type { UserCollection } from '../store/types';

export type Place = { address: string; location: GeoPoint } | null;

export class UsersService {
  constructor(private readonly users: UserCollection) {}

  async getMe(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (user === null) {
      throw new NotFoundError();
    }
    return user;
  }

  async updateAddress(userId: string, place: Place): Promise<User> {
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
