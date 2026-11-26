import type { Conversation, LastMessage, Message, Proposal, ProposalStatus } from '../models/conversation';

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
