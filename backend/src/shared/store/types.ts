import type { DealCollection, RatingCollection, ReputationCollection } from '../../components/deals/store/types';
import type { ConversationCollection, MessageCollection } from '../../components/messaging/store/types';
import type { BuyerRequest } from '../../components/posts/models/request';
import type { Listing } from '../../components/posts/models/listing';
import type { PhotoStorage } from '../../components/posts/store/photoStorage';
import type { CustomFieldCollection, OptionCollection, PostCollection } from '../../components/posts/store/types';
import type { SessionRepo, UserCollection } from '../../components/users/store/types';

// Every component's collections in one object, which the app passes to the routes.
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
  transaction<T>(work: (tx: TransactionStore) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type TransactionStore = Pick<Store, 'ratings' | 'reputations'>;
