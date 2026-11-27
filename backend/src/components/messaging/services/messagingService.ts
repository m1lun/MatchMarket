import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { isNumber, isObject, type Body } from '../../../shared/http/checks';
import { isOneOf, isTestOwner, testPartnerId } from '../../../shared/models/common';
import type { DealsService, DealTerms } from '../../deals/services/dealsService';
import type { Deal } from '../../deals/models/deal';
import type { Listing } from '../../posts/models/listing';
import type { BuyerRequest } from '../../posts/models/request';
import type { PostsService } from '../../posts/services/postsService';
import type { PublicUser } from '../../users/models/user';
import type { UsersService } from '../../users/services/usersService';
import {
  MAX_MESSAGE_LENGTH,
  MAX_NOTE_LENGTH,
  POST_KINDS,
  isParticipant,
  otherParticipant,
  type Conversation,
  type Message,
  type PostKind,
  type Proposal,
} from '../models/conversation';
import type { ConversationCollection, MessageCollection } from '../store/types';

const POST_ID = /^[0-9a-f]{24}$/;
const OPEN_FIELDS = ['postId', 'postKind', 'myPostId'];
const MESSAGE_FIELDS = ['text'];
const PROPOSAL_FIELDS = ['price', 'note'];

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

function bodyFields(body: unknown, allowed: string[]): { fields: Body; errors: string[] } {
  if (!isObject(body)) {
    return { fields: {}, errors: ['Request body must be a JSON object'] };
  }
  const errors = Object.keys(body)
    .filter((name) => !allowed.includes(name))
    .map((name) => `unsupported field "${name}"`);
  return { fields: body, errors };
}

interface OpenBody {
  postId: string;
  postKind: PostKind;
  myPostId: string | undefined;
}

function parseOpen(body: unknown): OpenBody {
  const { fields, errors } = bodyFields(body, OPEN_FIELDS);
  const postId = typeof fields.postId === 'string' && POST_ID.test(fields.postId) ? fields.postId : undefined;
  const postKind = typeof fields.postKind === 'string' && isOneOf(POST_KINDS, fields.postKind) ? fields.postKind : undefined;
  const myPostId = typeof fields.myPostId === 'string' && POST_ID.test(fields.myPostId) ? fields.myPostId : undefined;
  if (postId === undefined) {
    errors.push('postId must be the id of a listing or request');
  }
  if (postKind === undefined) {
    errors.push(`postKind must be one of: ${POST_KINDS.join(', ')}`);
  }
  if (fields.myPostId !== undefined && myPostId === undefined) {
    errors.push('myPostId must be the id of one of your posts');
  }
  if (errors.length > 0 || postId === undefined || postKind === undefined) {
    throw new BadRequestError(errors);
  }
  return { postId, postKind, myPostId };
}

function parseMessage(body: unknown): string {
  const { fields, errors } = bodyFields(body, MESSAGE_FIELDS);
  const text = typeof fields.text === 'string' ? fields.text.trim() : '';
  if (text === '' || text.length > MAX_MESSAGE_LENGTH) {
    errors.push(`text must be 1 to ${MAX_MESSAGE_LENGTH} characters`);
  }
  if (errors.length > 0) {
    throw new BadRequestError(errors);
  }
  return text;
}

function parseProposal(body: unknown): { price: number; note: string } {
  const { fields, errors } = bodyFields(body, PROPOSAL_FIELDS);
  const { price, note } = fields;
  if (!isNumber(price) || price < 0) {
    errors.push('price must be a number of at least 0');
  }
  if (note !== undefined && (typeof note !== 'string' || note.trim().length > MAX_NOTE_LENGTH)) {
    errors.push(`note must be text of at most ${MAX_NOTE_LENGTH} characters`);
  }
  if (errors.length > 0 || !isNumber(price)) {
    throw new BadRequestError(errors);
  }
  return { price, note: typeof note === 'string' ? note.trim() : '' };
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

  async open(me: string, body: unknown) {
    const { postId, postKind, myPostId } = parseOpen(body);
    const myKind = postKind === 'listing' ? 'request' : 'listing';
    const [post, myPost] = await Promise.all([
      this.posts.findById(postKind, postId),
      myPostId === undefined ? undefined : this.posts.findById(myKind, myPostId),
    ]);
    if (post !== null && isTestOwner(post.ownerId) && post.ownerId !== testPartnerId(me)) {
      throw new NotFoundError();
    }
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

  async listMessages(me: string, conversationId: string, limit: number, before: string | undefined) {
    const conversation = await this.findMyConversation(conversationId, me);
    // One extra message tells whether another page follows.
    const found = await this.store.messages.listByConversation(conversation.id, limit + 1, before);
    const { page, nextCursor } = toPage(found, limit);
    return { messages: page, nextCursor };
  }

  async send(me: string, conversationId: string, body: unknown): Promise<Message> {
    const text = parseMessage(body);
    const conversation = await this.findMyConversation(conversationId, me);
    const createdAt = new Date();
    const message = await this.store.messages.insert({ conversationId: conversation.id, senderId: me, text, createdAt });
    await this.store.conversations.recordMessage(conversation.id, { senderId: me, text, createdAt });
    this.events.publish([otherParticipant(conversation, me)], MESSAGE_CREATED, message);
    return message;
  }

  async propose(me: string, conversationId: string, body: unknown): Promise<Proposal> {
    const { price, note } = parseProposal(body);
    const conversation = await this.findMyConversation(conversationId, me);
    const proposal: Proposal = { proposerId: me, price, note, status: 'pending', createdAt: new Date() };
    if (!(await this.store.conversations.propose(conversation.id, proposal))) {
      throw new ConflictError('A proposal is already pending or accepted');
    }
    this.publishProposal(conversation, me, proposal);
    return proposal;
  }

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
