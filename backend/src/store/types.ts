import type { GeoPoint } from '../models/common';
import type { Conversation, LastMessage, Message, Proposal, ProposalStatus } from '../models/conversation';
import type { CustomField } from '../models/customField';
import type { Deal } from '../models/deal';
import type { Listing } from '../models/listing';
import type { Option } from '../models/option';
import type { Rating } from '../models/rating';
import type { BuyerRequest } from '../models/request';
import type { Reputation } from '../models/reputation';
import type { RefreshSession } from '../models/session';
import type { PublicUser, SignInProfile, User } from '../models/user';
import type { PhotoStorage } from '../photos/storage';

export interface PostDoc {
  id: string;
  ownerId: string;
  category: string;
  status: 'open' | 'closed';
  location: GeoPoint;
  updatedAt: Date;
}

// A post's price is a listing's price or a request's budget.
export interface PostFilter {
  category?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  near?: { lat: number; lng: number; radiusKm: number } | undefined;
}

export interface OpenPostFilter extends PostFilter {
  before?: string | undefined;
}

// Posts (listings or requests) are stored without an id; the store assigns one.
export interface PostCollection<T extends PostDoc> {
  insert(doc: Omit<T, 'id'>): Promise<T>;
  findById(id: string): Promise<T | null>;
  listByOwner(ownerId: string): Promise<T[]>;
  replace(doc: T): Promise<T>;
  remove(id: string): Promise<void>;
  // Newest first; passing the last post's id as `before` starts the next page.
  listOpen(excludeOwnerId: string, limit: number, filter?: OpenPostFilter): Promise<T[]>;
  // Every open post in a category from everyone except excludeOwnerId: the
  // candidates the matching feed filters and ranks.
  listOpenInCategory(category: string, excludeOwnerId: string): Promise<T[]>;
  // Every category in use, open or closed.
  listCategories(): Promise<string[]>;
  renameCategory(from: string, to: string): Promise<void>;
  // One query for a page of posts; only the named fields are returned.
  findByIds(ids: string[], fields: (keyof T)[], firstPhotoOnly?: boolean): Promise<Partial<T>[]>;
}

export interface OptionCollection {
  list(field: string): Promise<Option[]>;
  // Inserts if missing and returns the stored option either way.
  ensure(option: Option): Promise<Option>;
  // Inserts every missing option in a single round trip; existing ones are untouched.
  ensureMany(options: Option[]): Promise<void>;
  remove(field: string, key: string): Promise<void>;
}

export interface CustomFieldCollection {
  list(ownerId: string): Promise<CustomField[]>;
  upsert(def: CustomField): Promise<CustomField>;
  remove(ownerId: string, key: string): Promise<boolean>;
}

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

export interface DealCollection {
  insert(doc: Omit<Deal, 'id'>): Promise<Deal>;
  findById(id: string): Promise<Deal | null>;
  listByUser(userId: string, limit: number, before?: string): Promise<Deal[]>;
  removeBySellerAndBuyer(sellerId: string, buyerId: string): Promise<Deal[]>;
}

export interface RatingUpdate {
  previousStars: number;
  rating: Rating;
}

export interface RatingCollection {
  insert(doc: Omit<Rating, 'id'>): Promise<Rating>;
  update(dealId: string, raterId: string, stars: number, comment: string, now: Date): Promise<RatingUpdate | null>;
  listByDeals(dealIds: string[]): Promise<Rating[]>;
  removeByDealIds(dealIds: string[]): Promise<void>;
}

export interface ReputationCollection {
  find(userId: string): Promise<Reputation | null>;
  findMany(userIds: string[]): Promise<Reputation[]>;
  addRating(userId: string, stars: number, now: Date): Promise<Reputation>;
  changeStars(userId: string, delta: number, now: Date): Promise<Reputation | null>;
  remove(userId: string): Promise<void>;
}

export interface ConversationCollection {
  // The starter's conversation about the tapped post, created if there is none; created says which.
  open(doc: Omit<Conversation, 'id'>): Promise<{ conversation: Conversation; created: boolean }>;
  findById(id: string): Promise<Conversation | null>;
  // Newest activity first.
  listByUser(userId: string): Promise<Conversation[]>;
  recordMessage(id: string, message: LastMessage): Promise<void>;
  // Saves the proposal unless the current one is pending or accepted; false if it is.
  propose(id: string, proposal: Proposal): Promise<boolean>;
  setProposalStatus(id: string, status: ProposalStatus): Promise<void>;
  // Deletes every conversation the user is in and returns their ids.
  removeByUser(userId: string): Promise<string[]>;
}

export interface MessageCollection {
  insert(doc: Omit<Message, 'id'>): Promise<Message>;
  // Newest first; passing the last message's id as `before` starts the next page.
  listByConversation(conversationId: string, limit: number, before?: string): Promise<Message[]>;
  removeByConversations(conversationIds: string[]): Promise<void>;
}

export interface Store {
  listings: PostCollection<Listing>;
  requests: PostCollection<BuyerRequest>;
  options: OptionCollection;
  customFields: CustomFieldCollection;
  users: UserCollection;
  sessions: SessionRepo;
  deals: DealCollection;
  ratings: RatingCollection;
  reputations: ReputationCollection;
  conversations: ConversationCollection;
  messages: MessageCollection;
  photos: PhotoStorage;
  close(): Promise<void>;
}
