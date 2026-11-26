import { MongoClient, type MongoClientOptions } from 'mongodb';
import { createGridFsPhotoStorage } from '../../components/posts/store/photoStorage';
import { CONVERSATIONS_COLLECTION, MESSAGES_COLLECTION } from '../../components/messaging/models/conversation';
import { CUSTOM_FIELDS_COLLECTION } from '../../components/posts/models/customField';
import { DEALS_COLLECTION } from '../../components/deals/models/deal';
import { LISTINGS_COLLECTION, type Listing } from '../../components/posts/models/listing';
import { normaliseListing, normaliseRequest } from '../../components/posts/models/normalise';
import { OPTIONS_COLLECTION } from '../../components/posts/models/option';
import { RATINGS_COLLECTION } from '../../components/deals/models/rating';
import { REQUESTS_COLLECTION, type BuyerRequest } from '../../components/posts/models/request';
import { REPUTATIONS_COLLECTION } from '../../components/deals/models/reputation';
import { SESSIONS_COLLECTION } from '../../components/users/models/session';
import { USERS_COLLECTION } from '../../components/users/models/user';
import { MongoDealCollection, MongoRatingCollection, MongoReputationCollection, setupDealCollections } from '../../components/deals/store/dealStore';
import { MongoConversationCollection, MongoMessageCollection, setupMessagingCollections } from '../../components/messaging/store/messagingStore';
import { MongoCustomFieldCollection, MongoOptionCollection, MongoPostCollection, setupPostCollections } from '../../components/posts/store/postStore';
import { MongoSessionRepo, MongoUserCollection, setupUserCollections } from '../../components/users/store/userStore';
import type { Store, TransactionStore } from './types';

// Connects, sets up each component's collections, and wires the component stores into one Store.
export async function createMongoStore(uri: string, dbName: string, options?: MongoClientOptions): Promise<Store> {
  const client = new MongoClient(uri, options);
  await client.connect();
  const db = client.db(dbName);
  await Promise.all([
    setupPostCollections(db),
    setupUserCollections(db),
    setupDealCollections(db),
    setupMessagingCollections(db),
  ]);
  return {
    listings: new MongoPostCollection<Listing>(db.collection(LISTINGS_COLLECTION), normaliseListing, (range) => ({
      price: range,
    })),
    requests: new MongoPostCollection<BuyerRequest>(db.collection(REQUESTS_COLLECTION), normaliseRequest, (range) => ({
      requestFields: { $elemMatch: { key: 'price', value: range } },
    })),
    options: new MongoOptionCollection(db.collection(OPTIONS_COLLECTION)),
    customFields: new MongoCustomFieldCollection(db.collection(CUSTOM_FIELDS_COLLECTION)),
    users: new MongoUserCollection(db.collection(USERS_COLLECTION)),
    sessions: new MongoSessionRepo(db.collection(SESSIONS_COLLECTION)),
    deals: new MongoDealCollection(db.collection(DEALS_COLLECTION)),
    ratings: new MongoRatingCollection(db.collection(RATINGS_COLLECTION)),
    reputations: new MongoReputationCollection(db.collection(REPUTATIONS_COLLECTION)),
    transaction: async <T>(work: (tx: TransactionStore) => Promise<T>): Promise<T> => {
      const session = client.startSession();
      try {
        let result: T | undefined;
        await session.withTransaction(async () => {
          result = await work({
            ratings: new MongoRatingCollection(db.collection(RATINGS_COLLECTION), session),
            reputations: new MongoReputationCollection(db.collection(REPUTATIONS_COLLECTION), session),
          });
        });
        return result as T;
      } finally {
        await session.endSession();
      }
    },
    conversations: new MongoConversationCollection(db.collection(CONVERSATIONS_COLLECTION)),
    messages: new MongoMessageCollection(db.collection(MESSAGES_COLLECTION)),
    photos: createGridFsPhotoStorage(db),
    close: async () => {
      await client.close();
    },
  };
}
