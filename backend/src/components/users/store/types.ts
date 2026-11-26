import type { GeoPoint } from '../../../shared/models/common';
import type { RefreshSession } from '../models/session';
import type { PublicUser, SignInProfile, User } from '../models/user';

export interface UserCollection {
  // Creates the user at first sign-in. Later sign-ins refresh only the email and
  // photo: names are set once so an edit made in the app isn't undone. Leaving
  // pictureUrl out keeps the stored photo.
  upsertFromSignIn(profile: SignInProfile): Promise<void>;
  findById(id: string): Promise<User | null>;
  // The public fields of every user found, in one query; unknown ids are left out.
  findPublicByIds(ids: string[]): Promise<PublicUser[]>;
  // Sets the profile address, or clears it with null. Null if there is no such user.
  updateAddress(id: string, place: { address: string; location: GeoPoint } | null): Promise<User | null>;
}

export interface SessionRepo {
  insert(session: RefreshSession): Promise<void>;
  // Marks an unused, unexpired token as used and returns it, in one atomic
  // step so two concurrent refreshes cannot both succeed. Null otherwise.
  consume(tokenHash: string, now: Date): Promise<RefreshSession | null>;
  find(tokenHash: string): Promise<RefreshSession | null>;
  revokeFamily(familyId: string): Promise<void>;
}
