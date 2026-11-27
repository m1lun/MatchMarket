import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import type { DealsService, DealTerms } from '../../deals/services/dealsService';
import type { Deal } from '../../deals/models/deal';
import type { Listing } from '../../posts/models/listing';
import type { BuyerRequest } from '../../posts/models/request';
import type { PostsService } from '../../posts/services/postsService';
import type { PublicUser } from '../../users/models/user';
import type { UsersService } from '../../users/services/usersService';
import {
  isParticipant,
  otherParticipant,
  type Conversation,
  type Message,
  type PostKind,
  type Proposal,
} from '../models/conversation';
import type { ConversationCollection, MessageCollection } from '../store/types';

export const MESSAGE_CREATED = 'message.created';
export const PROPOSAL_UPDATED = 'proposal.updated';

export interface EventPublisher {
  publish(userIds: string[], type: string, data: unknown): void;
}

export interface MessagingStore {
  conversations: ConversationCollection;
  messages: MessageCollection;
}

interface PostDoc {
  id: string;
  ownerId: string;
  status: 'open' | 'closed';
}

interface DealPosts {
  listing: Listing | null;
  request: BuyerRequest | null;
}

// The fields of a listing or request the conversations list shows. Posts saved before posts had names
// have no name, so they show their category, as the store's findById does.
interface PostView {
  id?: string;
  name?: string;
  category?: string;
  status?: string;
  photoIds?: string[];
}

interface Lookups {
  userOf: Map<string, PublicUser>;
  listingOf: Map<string, PostView>;
  requestOf: Map<string, PostView>;
}

function byId(items: PostView[]): Map<string, PostView> {
  return new Map(items.flatMap((item) => (item.id === undefined ? [] : [[item.id, item] as const])));
}

function present(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

function postView(id: string | null, posts: Map<string, PostView>) {
  const post = id === null ? undefined : posts.get(id);
  return post === undefined
    ? null
    : { id, name: post.name ?? post.category, status: post.status, photoId: post.photoIds?.[0] ?? null };
}

function conversationView(conversation: Conversation, me: string, lookups: Lookups) {
  const other = otherParticipant(conversation, me);
  return {
    id: conversation.id,
    postKind: conversation.postKind,
    listing: postView(conversation.listingId, lookups.listingOf),
    request: postView(conversation.requestId, lookups.requestOf),
    otherUser: lookups.userOf.get(other) ?? { id: other, firstName: '', lastName: '', pictureUrl: null },
    lastMessage: conversation.lastMessage,
    proposal: conversation.proposal ?? null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

// Whether a post can start a conversation: someone else's open post, or with mine true, the caller's own open post.
function checkUsable(post: PostDoc | null, me: string, mine: boolean): asserts post is PostDoc {
  if (post === null) {
    throw new NotFoundError();
  }
  const isMine = post.ownerId === me;
  if (mine && !isMine) {
    throw new ForbiddenError();
  }
  if (!mine && isMine) {
    throw new BadRequestError(['you cannot start a conversation about your own post']);
  }
  if (post.status === 'closed') {
    throw new ConflictError('This post is closed');
  }
}

// The tapped post is someone else's; myPostId, if any, is the caller's post of the other kind.
function dealParties(postKind: PostKind, post: PostDoc, me: string, myPostId: string | undefined) {
  const myPost = myPostId ?? null;
  return postKind === 'listing'
    ? { listingId: post.id, requestId: myPost, sellerId: post.ownerId, buyerId: me }
    : { listingId: myPost, requestId: post.id, sellerId: me, buyerId: post.ownerId };
}

// Splits a fetch of limit + 1 items into the page and the cursor for the next one.
export function toPage<T extends { id: string }>(found: T[], limit: number): { page: T[]; nextCursor: string | null } {
  const page = found.slice(0, limit);
  const last = page[page.length - 1];
  return { page, nextCursor: found.length > limit && last !== undefined ? last.id : null };
}

// A post the conversation is about was deleted or closed, e.g. because it already has a deal.
function anyPostGone(conversation: Conversation, posts: DealPosts): boolean {
  return (
    (conversation.listingId !== null && posts.listing?.status !== 'open') ||
    (conversation.requestId !== null && posts.request?.status !== 'open')
  );
}

// The pending proposal the caller may accept or decline: only the other participant can.
function proposalToAnswer(conversation: Conversation, me: string): Proposal {
  const { proposal } = conversation;
  if (proposal?.status !== 'pending') {
    throw new ConflictError('There is no pending proposal');
  }
  if (proposal.proposerId === me) {
    throw new ForbiddenError('You cannot answer your own proposal');
  }
  return proposal;
}

export class MessagingService {
  constructor(
    private readonly store: MessagingStore,
    private readonly posts: PostsService,
    private readonly users: UsersService,
    private readonly deals: DealsService,
    private readonly events: EventPublisher,
  ) {}

  // Opens the caller's conversation with the owner of the tapped post; myPostId is the caller's post it was
  // recommended for. Returns the existing conversation unchanged if there is one; created says which.
  async open(me: string, postId: string, postKind: PostKind, myPostId: string | undefined) {
    const myKind = postKind === 'listing' ? 'request' : 'listing';
    const [post, myPost] = await Promise.all([
      this.posts.findById(postKind, postId),
      myPostId === undefined ? undefined : this.posts.findById(myKind, myPostId),
    ]);
    checkUsable(post, me, false);
    if (myPost !== undefined) {
      checkUsable(myPost, me, true);
    }
    const now = new Date();
    return this.store.conversations.open({
      ...dealParties(postKind, post, me, myPostId),
      postKind,
      lastMessage: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  // The caller's conversations, newest activity first, in at most 4 queries.
  async listInbox(me: string) {
    const conversations = await this.store.conversations.listByUser(me);
    const others = [...new Set(conversations.map((c) => otherParticipant(c, me)))];
    const [users, listings, requests] = await Promise.all([
      this.users.findPublicByIds(others),
      this.posts.findByIds('listing', present(conversations.map((c) => c.listingId)), ['name', 'category', 'status', 'photoIds'], true),
      this.posts.findByIds('request', present(conversations.map((c) => c.requestId)), ['name', 'category', 'status', 'photoIds'], true),
    ]);
    const lookups: Lookups = {
      userOf: new Map(users.map((user) => [user.id, user])),
      listingOf: byId(listings),
      requestOf: byId(requests),
    };
    return { conversations: conversations.map((c) => conversationView(c, me, lookups)) };
  }

  // Newest first; nextCursor is null on the last page.
  async listMessages(me: string, conversationId: string, limit: number, before: string | undefined) {
    const conversation = await this.findMyConversation(conversationId, me);
    // One extra message tells whether another page follows.
    const found = await this.store.messages.listByConversation(conversation.id, limit + 1, before);
    const { page, nextCursor } = toPage(found, limit);
    return { messages: page, nextCursor };
  }

  async send(me: string, conversationId: string, text: string): Promise<Message> {
    const conversation = await this.findMyConversation(conversationId, me);
    const createdAt = new Date();
    const message = await this.store.messages.insert({ conversationId: conversation.id, senderId: me, text, createdAt });
    await this.store.conversations.recordMessage(conversation.id, { senderId: me, text, createdAt });
    this.events.publish([otherParticipant(conversation, me)], MESSAGE_CREATED, message);
    return message;
  }

  // Proposes a price to the other participant. 409 while a proposal is pending, or once one was accepted.
  async propose(me: string, conversationId: string, price: number, note: string): Promise<Proposal> {
    const conversation = await this.findMyConversation(conversationId, me);
    const proposal: Proposal = { proposerId: me, price, note, status: 'pending', createdAt: new Date() };
    if (!(await this.store.conversations.propose(conversation.id, proposal))) {
      throw new ConflictError('A proposal is already pending or accepted');
    }
    this.publishProposal(conversation, me, proposal);
    return proposal;
  }

  // Makes the deal from the conversation's posts and people at the proposed price, and closes the posts.
  // Retrying after a failure finishes the same deal.
  async accept(me: string, conversationId: string): Promise<{ deal: Deal; proposal: Proposal }> {
    const conversation = await this.findMyConversation(conversationId, me);
    const proposal = proposalToAnswer(conversation, me);
    const { listingId, requestId, sellerId, buyerId } = conversation;
    const terms: DealTerms = { listingId, requestId, sellerId, buyerId, agreedPrice: proposal.price };
    const [posts, earlier] = await Promise.all([this.findDealPosts(conversation), this.deals.findByPosts(conversation)]);
    const now = new Date();
    let deal: Deal | null;
    if (earlier !== null) {
      deal = this.deals.earlierDeal(earlier, terms);
    } else {
      deal = anyPostGone(conversation, posts) ? null : await this.deals.recordDeal(terms, now);
    }
    if (deal === null) {
      throw new ConflictError('This post is no longer available');
    }
    await this.posts.closeForDeal(posts.listing?.id ?? null, posts.request?.id ?? null, now);
    // Last, so a proposal still pending means a retry can finish the accept.
    await this.store.conversations.setProposalStatus(conversation.id, 'accepted');
    const accepted: Proposal = { ...proposal, status: 'accepted' };
    this.publishProposal(conversation, me, accepted);
    return { deal, proposal: accepted };
  }

  // Turns down the pending proposal; either side can then propose again.
  async decline(me: string, conversationId: string): Promise<Proposal> {
    const conversation = await this.findMyConversation(conversationId, me);
    const proposal = proposalToAnswer(conversation, me);
    await this.store.conversations.setProposalStatus(conversation.id, 'declined');
    const declined: Proposal = { ...proposal, status: 'declined' };
    this.publishProposal(conversation, me, declined);
    return declined;
  }

  private async findMyConversation(id: string, me: string): Promise<Conversation> {
    const conversation = await this.store.conversations.findById(id);
    if (conversation === null) {
      throw new NotFoundError();
    }
    if (!isParticipant(conversation, me)) {
      throw new ForbiddenError();
    }
    return conversation;
  }

  private async findDealPosts(conversation: Conversation): Promise<DealPosts> {
    const [listing, request] = await Promise.all([
      conversation.listingId === null ? null : this.posts.findById('listing', conversation.listingId),
      conversation.requestId === null ? null : this.posts.findById('request', conversation.requestId),
    ]);
    return { listing, request };
  }

  // Tells the other participant's open chat that the proposal changed.
  private publishProposal(conversation: Conversation, me: string, proposal: Proposal): void {
    this.events.publish([otherParticipant(conversation, me)], PROPOSAL_UPDATED, { conversationId: conversation.id, proposal });
  }
}
