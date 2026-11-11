import type { Server } from 'node:http';

import {
  TOKEN_CASES,
  clearConversationData,
  makeConversation,
  makeListingConversation,
  post,
  type TokenCase,
} from '../helpers/conversationFixtures';
import { ME, OTHER, STRANGER, makeListing } from '../helpers/dealFixtures';
import { openEventStream, type EventStream } from '../helpers/eventStream';
import { startTestApp, stopTestApp } from '../helpers/testApp';
import { createTestStore, type TestStore } from '../helpers/testStore';

let mongo: TestStore;
let app: Server;
let streams: EventStream[] = [];

beforeAll(async () => {
  mongo = await createTestStore();
  app = await startTestApp(mongo.store);
});

afterAll(async () => {
  await stopTestApp(app);
  await mongo.dropAndClose();
});

beforeEach(async () => {
  await clearConversationData(mongo.db);
});

// Open streams keep their connections alive, so the server could not stop.
afterEach(() => {
  streams.forEach((stream) => {
    stream.close();
  });
  streams = [];
});

async function open(userId: string, auth?: string | null): Promise<EventStream> {
  const stream = await openEventStream(app, userId, auth);
  streams.push(stream);
  return stream;
}

function sendMessage(conversationId: string, userId: string, text: string): Promise<{ status: number; body: unknown }> {
  return post(app, `/api/conversations/${conversationId}/messages`, { text }, { userId });
}

// Interface GET /api/events
describe('Unmocked: GET /api/events', () => {
  // Input: a valid session token for ME
  // Expected status code: 200
  // Expected behavior: the response stays open as an event stream
  // Expected output: headers Content-Type: text/event-stream and Cache-Control: no-cache, and no events yet
  test('Opens A Stream: 200', async () => {
    const stream = await open(ME);

    expect(stream.status).toBe(200);
    expect(stream.response.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(stream.response.headers['cache-control']).toBe('no-cache');
    expect(stream.events).toStrictEqual([]);
  });

  // Input: ME and OTHER both have a stream open; ME sends 'Is it available?', then OTHER replies 'Yes'
  // Expected status code: 200 for the streams, 201 for the messages
  // Expected behavior: each message reaches only the other participant, never its sender
  // Expected output: OTHER's stream gets one message.created event with ME's message; ME's gets one with OTHER's reply
  test('Message Reaches The Other Participant', async () => {
    const conversation = await makeListingConversation(mongo.store);
    const mine = await open(ME);
    const theirs = await open(OTHER);

    const sent = await sendMessage(conversation.id, ME, 'Is it available?');
    const [received] = await theirs.waitForEvents(1);
    await sendMessage(conversation.id, OTHER, 'Yes');

    expect(received).toStrictEqual({ type: 'message.created', data: sent.body });
    expect(await mine.waitForEvents(1)).toMatchObject([{ type: 'message.created', data: { senderId: OTHER, text: 'Yes' } }]);
  });

  // Input: ME proposes 35 and OTHER accepts it, or ME proposes 35 and OTHER declines it; both have a stream open
  // Expected status code: 200 for the streams, 201 or 200 for the proposal routes
  // Expected behavior: each change reaches only the other participant
  // Expected output: OTHER gets proposal.updated with the pending proposal; ME then gets it with the accepted or declined one
  test.each([
    { label: 'Accepted', action: 'accept', status: 'accepted' },
    { label: 'Declined', action: 'decline', status: 'declined' },
  ])('Proposal $label Reaches The Other Participant', async ({ action, status }: { label: string; action: string; status: string }) => {
    const listing = await makeListing(mongo.store, OTHER);
    const conversation = await makeConversation(mongo.store, { listingId: listing.id, sellerId: OTHER, buyerId: ME, postKind: 'listing' });
    const mine = await open(ME);
    const theirs = await open(OTHER);

    await post(app, `/api/conversations/${conversation.id}/proposal`, { price: 35 });
    const [proposed] = await theirs.waitForEvents(1);
    await post(app, `/api/conversations/${conversation.id}/proposal/${action}`, {}, { userId: OTHER });
    const [answered] = await mine.waitForEvents(1);

    expect(proposed).toMatchObject({ type: 'proposal.updated', data: { conversationId: conversation.id, proposal: { proposerId: ME, price: 35, status: 'pending' } } });
    expect(answered).toMatchObject({ type: 'proposal.updated', data: { conversationId: conversation.id, proposal: { proposerId: ME, status } } });
  });

  // Input: OTHER has two streams open, as on two devices; ME sends a message
  // Expected status code: 200 for both streams
  // Expected behavior: the message is written to every stream of the recipient
  // Expected output: one message.created event on each of OTHER's streams
  test('Every Stream Of The Recipient Gets It', async () => {
    const conversation = await makeListingConversation(mongo.store);
    const phone = await open(OTHER);
    const tablet = await open(OTHER);

    await sendMessage(conversation.id, ME, 'hi');

    expect(await phone.waitForEvents(1)).toMatchObject([{ type: 'message.created', data: { text: 'hi' } }]);
    expect(await tablet.waitForEvents(1)).toMatchObject([{ type: 'message.created', data: { text: 'hi' } }]);
  });

  // Input: STRANGER has a stream open; ME sends a message to OTHER, then OTHER sends one to STRANGER in another conversation
  // Expected status code: 200 for the stream
  // Expected behavior: STRANGER gets nothing from conversations they are not in
  // Expected output: STRANGER's stream has exactly one event, the message from their own conversation
  test('Other Users Get Nothing', async () => {
    const conversation = await makeListingConversation(mongo.store);
    const strangersListing = await makeListing(mongo.store, OTHER);
    const strangers = await makeConversation(mongo.store, { listingId: strangersListing.id, sellerId: OTHER, buyerId: STRANGER, postKind: 'listing' });
    const stream = await open(STRANGER);

    await sendMessage(conversation.id, ME, 'not for you');
    await sendMessage(strangers.id, OTHER, 'for you');

    expect(await stream.waitForEvents(1)).toMatchObject([{ type: 'message.created', data: { text: 'for you' } }]);
  });

  // Input: no Authorization header, or a token that is not a valid JWT
  // Expected status code: 401
  // Expected behavior: no stream is opened
  // Expected output: { error } naming the auth problem, after which the response ends
  test.each(TOKEN_CASES)('$label: 401', async ({ auth, error }: TokenCase) => {
    const stream = await open(ME, auth);

    expect(stream.status).toBe(401);
    expect(JSON.parse(await stream.body()) as unknown).toStrictEqual({ error });
  });
});

