import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

import { createApp } from './app';
import { env } from './config/env';
import { errorMessage } from './errors';
import { createMongoStore } from './store/mongoStore';
import { normaliseStoredCategories, seedOptions } from './store/seed';
import type { Store } from './store/types';

// Certificate paths are string literals so Codacy's
// security/detect-non-literal-fs-filename rule passes. They resolve against
// the backend directory, the working directory for `npm start` and the
// Docker image's WORKDIR.
function start(store: Store): void {
  const app = createApp({ sessions: store.sessions, store, e2eRoutes: env.e2eRoutes });
  const server = env.httpsEnabled
    ? createHttpsServer(
        {
          cert: readFileSync('./certs/server.crt'),
          key: readFileSync('./certs/server.key'),
        },
        app
      )
    : createHttpServer(app);

  server.listen(env.port, () => {
    const scheme = env.httpsEnabled ? 'https' : 'http';
    // Startup config only, never request data, so there is nothing to forge.
    console.info(`Server listening on ${scheme}://0.0.0.0:${env.port}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      // Once the server and the MongoDB connection are closed nothing is left
      // running, so Node exits on its own.
      server.close(() => {
        store.close().catch((cause: unknown) => {
          console.error(`Could not close MongoDB cleanly: ${errorMessage(cause)}`);
          process.exitCode = 1;
        });
      });
      // Live update streams never end on their own, so close() would wait for them forever.
      server.closeAllConnections();
    });
  }
}

createMongoStore(env.mongoUri, env.mongoDb)
  .then(async (store) => {
    await normaliseStoredCategories(store);
    await seedOptions(store);
    return store;
  })
  .then(start, (cause: unknown) => {
    console.error(`Could not set up MongoDB: ${errorMessage(cause)}`);
    process.exitCode = 1;
  });
