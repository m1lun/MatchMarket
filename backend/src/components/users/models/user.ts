import type { GeoPoint } from '../../../shared/models/common';

export const USERS_COLLECTION = 'users';

// One row per Google account, created at first sign-in.
export interface User {
  // Google account id (`sub`): the same value as a post's ownerId.
  id: string;
  firstName: string;
  lastName: string;
  // The verified Google sign-in email; never taken from the app.
  email: string;
  pictureUrl: string | null;
  // A place picked in the profile, possibly just a neighbourhood. Both are set
  // or both are absent.
  address?: string;
  location?: GeoPoint;
  createdAt: Date;
  updatedAt: Date;
}

// The fields other users may see, e.g. on deals and messages.
export type PublicUser = Pick<User, 'id' | 'firstName' | 'lastName' | 'pictureUrl'>;

// What a sign-in knows about the user. A token refresh has no photo, so it
// leaves pictureUrl out.
export type SignInProfile = Pick<User, 'id' | 'firstName' | 'lastName' | 'email'> & {
  pictureUrl?: string | null;
};
