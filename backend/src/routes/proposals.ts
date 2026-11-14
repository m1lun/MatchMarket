import { Router } from 'express';
import type { Response } from 'express';

import { BadRequestError } from '../errors';
import { PROPOSAL_UPDATED, type EventHub } from '../events';
import { MAX_NOTE_LENGTH, otherParticipant, type Conversation, type Proposal } from '../models/conversation';
import type { Deal } from '../models/deal';
import type { Listing } from '../models/listing';
import type { BuyerRequest } from '../models/request';
import { currentUser } from '../sessions';
import type { Store } from '../store/types';
import { isNumber } from './checks';
import { bodyFields, findMyConversation } from './conversations';
import { handle } from './handle';

// MongoDB's code for an insert that breaks a unique index.
const DUPLICATE_KEY = 11000;
const PROPOSAL_FIELDS = ['price', 'note'];

interface DealPosts {
  listing: Listing | null;
  request: BuyerRequest | null;
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

// The pending proposal the caller may accept or decline: only the other participant can.
// Sends the 409 or 403 itself and returns null when there is none.
function proposalToAnswer(res: Response, conversation: Conversation): Proposal | null {
  const { proposal } = conversation;
  if (proposal?.status !== 'pending') {
    res.status(409).json({ error: 'There is no pending proposal' });
    return null;
  }
  if (proposal.proposerId === currentUser(res).id) {
    res.status(403).json({ error: 'You cannot answer your own proposal' });
    return null;
  }
  return proposal;
}

async function findDealPosts(store: Store, conversation: Conversation): Promise<DealPosts> {
  const [listing, request] = await Promise.all([
    conversation.listingId === null ? null : store.listings.findById(conversation.listingId),
    conversation.requestId === null ? null : store.requests.findById(conversation.requestId),
  ]);
  return { listing, request };
}

// A post the conversation is about was deleted or closed, e.g. because it already has a deal.
function anyPostGone(conversation: Conversation, posts: DealPosts): boolean {
  return (
    (conversation.listingId !== null && posts.listing?.status !== 'open') ||
    (conversation.requestId !== null && posts.request?.status !== 'open')
  );
}

// A deal already on these posts is either this proposal's, recorded by an earlier accept that failed
// before closing the posts, which this accept finishes, or another sale, which makes the posts unavailable.
function earlierAccept(deal: Deal, conversation: Conversation, proposal: Proposal): Deal | null {
  const same =
    deal.listingId === conversation.listingId &&
    deal.requestId === conversation.requestId &&
    deal.sellerId === conversation.sellerId &&
    deal.buyerId === conversation.buyerId &&
    deal.agreedPrice === proposal.price;
  return same ? deal : null;
}

// Null if one of the posts got a deal since the check before it (deals are unique per post).
async function insertDeal(store: Store, doc: Omit<Deal, 'id'>): Promise<Deal | null> {
  try {
    return await store.deals.insert(doc);
  } catch (error) {
    if ((error as { code?: number }).code === DUPLICATE_KEY) {
      return null;
    }
    throw error;
  }
}

async function newDeal(store: Store, conversation: Conversation, proposal: Proposal, posts: DealPosts, now: Date): Promise<Deal | null> {
  if (anyPostGone(conversation, posts)) {
    return null;
  }
  const { listingId, requestId, sellerId, buyerId } = conversation;
  return insertDeal(store, { listingId, requestId, sellerId, buyerId, agreedPrice: proposal.price, createdAt: now });
}

async function closePosts(store: Store, posts: DealPosts, now: Date): Promise<void> {
  await Promise.all([
    posts.listing === null ? undefined : store.listings.replace({ ...posts.listing, status: 'closed', updatedAt: now }),
    posts.request === null ? undefined : store.requests.replace({ ...posts.request, status: 'closed', updatedAt: now }),
  ]);
}

// Tells the other participant's open chat that the proposal changed.
function publishProposal(events: EventHub, res: Response, conversation: Conversation, proposal: Proposal): void {
  const other = otherParticipant(conversation, currentUser(res).id);
  events.publish([other], PROPOSAL_UPDATED, { conversationId: conversation.id, proposal });
}

function sendPostGone(res: Response): void {
  res.status(409).json({ error: 'This post is no longer available' });
}

export function createProposalsRouter(store: Store, events: EventHub): Router {
  const router = Router();

  // POST /api/conversations/:id/proposal — `{ price, note? }` proposes a price to the other participant.
  // 409 while a proposal is pending, or once one was accepted.
  router.post('/:id/proposal', handle(async (req, res) => {
    const { price, note } = parseProposal(req.body);
    const conversation = await findMyConversation(store, req, res);
    if (conversation === null) {
      return;
    }
    const proposal: Proposal = { proposerId: currentUser(res).id, price, note, status: 'pending', createdAt: new Date() };
    if (!(await store.conversations.propose(conversation.id, proposal))) {
      res.status(409).json({ error: 'A proposal is already pending or accepted' });
      return;
    }
    publishProposal(events, res, conversation, proposal);
    res.status(201).json(proposal);
  }));

  // POST /api/conversations/:id/proposal/accept — makes the deal from the conversation's posts and people
  // at the proposed price, and closes the posts. Retrying after a failure finishes the same deal.
  router.post('/:id/proposal/accept', handle(async (req, res) => {
    const conversation = await findMyConversation(store, req, res);
    if (conversation === null) {
      return;
    }
    const proposal = proposalToAnswer(res, conversation);
    if (proposal === null) {
      return;
    }
    const [posts, earlier] = await Promise.all([findDealPosts(store, conversation), store.deals.findByPosts(conversation)]);
    const now = new Date();
    const deal = earlier === null
      ? await newDeal(store, conversation, proposal, posts, now)
      : earlierAccept(earlier, conversation, proposal);
    if (deal === null) {
      sendPostGone(res);
      return;
    }
    await closePosts(store, posts, now);
    // Last, so a proposal still pending means a retry can finish the accept.
    await store.conversations.setProposalStatus(conversation.id, 'accepted');
    const accepted: Proposal = { ...proposal, status: 'accepted' };
    publishProposal(events, res, conversation, accepted);
    res.status(201).json({ deal, proposal: accepted });
  }));

  // POST /api/conversations/:id/proposal/decline — turns down the pending proposal; either side can then propose again.
  router.post('/:id/proposal/decline', handle(async (req, res) => {
    const conversation = await findMyConversation(store, req, res);
    if (conversation === null) {
      return;
    }
    const proposal = proposalToAnswer(res, conversation);
    if (proposal === null) {
      return;
    }
    await store.conversations.setProposalStatus(conversation.id, 'declined');
    const declined: Proposal = { ...proposal, status: 'declined' };
    publishProposal(events, res, conversation, declined);
    res.json(declined);
  }));

  return router;
}
