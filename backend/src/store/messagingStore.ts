import { ObjectId, type Collection, type Db, type Document } from 'mongodb';
import { CONVERSATIONS_COLLECTION, MESSAGES_COLLECTION, type Conversation, type LastMessage, type Message, type Proposal, type ProposalStatus } from '../models/conversation';
import { conversationSchema, messageSchema } from '../models/schema';
import type { ConversationCollection, MessageCollection } from './types';
import { applySchema, insertDoc, toDoc, toDocs } from './mongoHelpers';
import type { Stored } from './mongoHelpers';

export class MongoConversationCollection implements ConversationCollection {
  constructor(private readonly collection: Collection) {}

  // One upsert, so two taps on "Message" can't start two conversations. The filter has no postKind,
  // so the same two people reuse a conversation they already have about these posts.
  async open(doc: Omit<Conversation, 'id'>): Promise<{ conversation: Conversation; created: boolean }> {
    const sameItem = doc.postKind === 'listing'
      ? { listingId: doc.listingId, buyerId: doc.buyerId }
      : { requestId: doc.requestId, sellerId: doc.sellerId };
    const result = await this.collection.findOneAndUpdate(
      sameItem,
      { $setOnInsert: doc },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    );
    // An upsert that returns the document after it always finds one.
    return {
      conversation: toDoc<Conversation>(result.value as Stored<Conversation>),
      created: result.lastErrorObject?.updatedExisting !== true,
    };
  }

  async findById(id: string): Promise<Conversation | null> {
    if (!ObjectId.isValid(id)) {
      return null;
    }
    const found = await this.collection.findOne({ _id: new ObjectId(id) });
    return found === null ? null : toDoc<Conversation>(found as Stored<Conversation>);
  }

  async listByUser(userId: string): Promise<Conversation[]> {
    const found = await this.collection
      .find({ $or: [{ sellerId: userId }, { buyerId: userId }] })
      .sort({ updatedAt: -1, _id: -1 })
      .toArray();
    return toDocs<Conversation>(found as unknown[]);
  }

  async recordMessage(id: string, message: LastMessage): Promise<void> {
    await this.collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { lastMessage: message, updatedAt: message.createdAt } },
    );
  }

  // The check is in the filter, so two proposals sent at once can't both be saved.
  async propose(id: string, proposal: Proposal): Promise<boolean> {
    const result = await this.collection.updateOne(
      { _id: new ObjectId(id), 'proposal.status': { $nin: ['pending', 'accepted'] } },
      { $set: { proposal, updatedAt: proposal.createdAt } },
    );
    return result.matchedCount === 1;
  }

  async setProposalStatus(id: string, status: ProposalStatus): Promise<void> {
    await this.collection.updateOne({ _id: new ObjectId(id) }, { $set: { 'proposal.status': status, updatedAt: new Date() } });
  }

  async removeByUser(userId: string): Promise<string[]> {
    const filter = { $or: [{ sellerId: userId }, { buyerId: userId }] };
    const found = toDocs<{ id: string }>((await this.collection.find(filter, { projection: { _id: 1 } }).toArray()) as unknown[]);
    await this.collection.deleteMany(filter);
    return found.map((conversation) => conversation.id);
  }
}

export class MongoMessageCollection implements MessageCollection {
  constructor(private readonly collection: Collection) {}

  insert(doc: Omit<Message, 'id'>): Promise<Message> {
    return insertDoc<Message>(this.collection, doc);
  }

  async removeByConversations(conversationIds: string[]): Promise<void> {
    await this.collection.deleteMany({ conversationId: { $in: conversationIds } });
  }

  async listByConversation(conversationId: string, limit: number, before?: string): Promise<Message[]> {
    const query: Document = { conversationId };
    if (before !== undefined) {
      query._id = { $lt: new ObjectId(before) };
    }
    const found = await this.collection.find(query).sort({ _id: -1 }).limit(limit).toArray();
    return toDocs<Message>(found as unknown[]);
  }
}

export async function setupMessagingCollections(db: Db): Promise<void> {
  await Promise.all([
    applySchema(db, CONVERSATIONS_COLLECTION, conversationSchema),
    applySchema(db, MESSAGES_COLLECTION, messageSchema),
  ]);
  await Promise.all([
    db.collection(CONVERSATIONS_COLLECTION).createIndexes([
      { key: { listingId: 1, buyerId: 1 }, unique: true, partialFilterExpression: { postKind: 'listing' } },
      { key: { requestId: 1, sellerId: 1 }, unique: true, partialFilterExpression: { postKind: 'request' } },
      { key: { sellerId: 1, updatedAt: -1 } },
      { key: { buyerId: 1, updatedAt: -1 } },
    ]),
    db.collection(MESSAGES_COLLECTION).createIndex({ conversationId: 1, _id: -1 }),
  ]);
}
