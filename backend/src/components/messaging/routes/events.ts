import type { Response } from 'express';

// A comment line this often keeps networks from dropping a stream that has been quiet for a while.
const HEARTBEAT_MS = 25_000;

export const MESSAGE_CREATED = 'message.created';
export const PROPOSAL_UPDATED = 'proposal.updated';

// Server-Sent Events: each open GET /api/events response stays open, and events are written to it as they happen.
export class EventHub {
  // A user can have more than one stream, e.g. two devices, or a reconnect before the old stream has closed.
  private readonly streams = new Map<string, Set<Response>>();

  open(userId: string, res: Response): void {
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.flushHeaders();
    const userStreams = this.streams.get(userId) ?? new Set<Response>();
    userStreams.add(res);
    this.streams.set(userId, userStreams);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    res.on('close', () => {
      clearInterval(heartbeat);
      userStreams.delete(res);
      if (userStreams.size === 0) {
        this.streams.delete(userId);
      }
    });
  }

  publish(userIds: string[], type: string, data: unknown): void {
    const event = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const userId of userIds) {
      for (const res of this.streams.get(userId) ?? []) {
        res.write(event);
      }
    }
  }
}
