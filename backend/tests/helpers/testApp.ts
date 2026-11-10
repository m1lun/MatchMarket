import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import { createApp } from '../../src/app';
import type { Store } from '../../src/store/types';
import { MemorySessionRepo } from './memorySessionRepo';

// request(app) listens on every address, so on macOS its 127.0.0.1 calls can reach another program on that port.
export async function startTestApp(store: Store, e2eRoutes = false): Promise<Server> {
  const server = createServer(createApp({ sessions: new MemorySessionRepo(), store, e2eRoutes }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

export function stopTestApp(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}
