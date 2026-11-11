import type { Server } from 'node:http';

import { ME } from '../helpers/dealFixtures';
import { openEventStream, type EventStream } from '../helpers/eventStream';
import { startTestApp, stopTestApp } from '../helpers/testApp';
import { createTestStore, type TestStore } from '../helpers/testStore';

const HEARTBEAT_MS = 25_000;
const PING = ': ping\n\n';

let mongo: TestStore;
let app: Server;
let stream: EventStream | undefined;

beforeAll(async () => {
  mongo = await createTestStore();
  app = await startTestApp(mongo.store);
});

afterAll(async () => {
  await stopTestApp(app);
  await mongo.dropAndClose();
});

// Only the heartbeat's interval is faked; sockets and the database keep their real timers.
beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: [
      'Date', 'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate',
      'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
    ],
  });
});

afterEach(() => {
  stream?.close();
  stream = undefined;
  jest.useRealTimers();
});

function pings(text: string): number {
  return text.split(PING).length - 1;
}

// The server handles the closed connection asynchronously, so wait for it to clear the timer.
async function timersCleared(): Promise<void> {
  while (jest.getTimerCount() > 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// Interface GET /api/events
describe('Mocked: GET /api/events', () => {
  // Mocked behavior: setInterval is faked, so 25 seconds pass at once
  // Input: a valid session token for ME, then 25 seconds pass twice with no events
  // Expected status code: 200
  // Expected behavior: the server writes a heartbeat comment every 25 seconds so the quiet stream is not dropped
  // Expected output: one ': ping' comment after 25 seconds, two after 50
  test('Heartbeat Every 25 Seconds: 200', async () => {
    stream = await openEventStream(app, ME);
    expect(stream.status).toBe(200);
    expect(stream.text).toBe('');

    jest.advanceTimersByTime(HEARTBEAT_MS);
    await stream.waitForText(PING);
    expect(pings(stream.text)).toBe(1);

    jest.advanceTimersByTime(HEARTBEAT_MS);
    await stream.waitForText(PING + PING);
    expect(pings(stream.text)).toBe(2);
  });

  // Mocked behavior: setInterval and clearInterval are faked, so the heartbeat timer can be counted
  // Input: ME opens a stream and then closes the connection, as when the app leaves the chat or loses its network
  // Expected status code: 200
  // Expected behavior: the server forgets the stream and clears its heartbeat timer
  // Expected output: none after the connection closes
  test('Closing Clears The Heartbeat: 200', async () => {
    stream = await openEventStream(app, ME);
    expect(stream.status).toBe(200);
    expect(jest.getTimerCount()).toBe(1);

    stream.close();

    await timersCleared();
    expect(jest.getTimerCount()).toBe(0);
  });
});
