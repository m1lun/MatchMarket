import { once } from 'node:events';
import { request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { bearer } from './dealFixtures';

export interface ServerEvent {
  type: string;
  data: unknown;
}

// A client for GET /api/events that keeps everything the server writes, so tests can wait for events.
export class EventStream {
  text = '';

  constructor(readonly response: IncomingMessage) {
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      this.text += chunk;
    });
  }

  get status(): number | undefined {
    return this.response.statusCode;
  }

  get events(): ServerEvent[] {
    return this.text
      .split('\n\n')
      .filter((block) => block.startsWith('event: '))
      .map((block) => {
        const [typeLine = '', dataLine = ''] = block.split('\n');
        return { type: typeLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) as unknown };
      });
  }

  async waitForText(expected: string): Promise<void> {
    while (!this.text.includes(expected)) {
      await once(this.response, 'data');
    }
  }

  async waitForEvents(count: number): Promise<ServerEvent[]> {
    while (this.events.length < count) {
      await once(this.response, 'data');
    }
    return this.events;
  }

  // Resolves once the whole response has arrived; only for responses that end, such as a 401.
  async body(): Promise<string> {
    if (!this.response.complete) {
      await once(this.response, 'end');
    }
    return this.text;
  }

  close(): void {
    this.response.destroy();
  }
}

// Opens the stream as `userId`, or with the raw Authorization header `auth` (null sends none).
export async function openEventStream(server: Server, userId: string, auth?: string | null): Promise<EventStream> {
  const { port } = server.address() as AddressInfo;
  const header = auth === undefined ? bearer(userId) : auth;
  const sent = request({
    host: '127.0.0.1',
    port,
    path: '/api/events',
    agent: false,
    headers: header === null ? {} : { Authorization: header },
  });
  sent.end();
  const [response] = (await once(sent, 'response')) as [IncomingMessage];
  return new EventStream(response);
}
