import express, { type Express, type Response } from 'express';

import { errorHandler } from './shared/errors';
import { EventHub } from './components/messaging/routes/events';
import { verifyGoogleIdToken } from './components/users/services/googleAuth';
import { isText } from './shared/http/checks';
import { createConversationsRouter } from './components/messaging/routes/conversations';
import { createCustomFieldsRouter } from './components/posts/routes/customFields';
import { createDealsRouter } from './components/deals/routes/deals';
import { createE2ePartnerRouter, createE2eRouter } from './testSupport/e2e';
import { createFeedRouter } from './components/matching/routes/feed';
import { createListingsRouter } from './components/posts/routes/listings';
import { createPhotosRouter } from './components/posts/routes/photos';
import { createRatingsRouter, createReputationRouter, ratingBodyTooLarge } from './components/deals/routes/ratings';
import { createOptionsRouter } from './components/posts/routes/options';
import { createProposalsRouter } from './components/messaging/routes/proposals';
import { createRequestsRouter } from './components/posts/routes/requests';
import { createUsersRouter } from './components/users/routes/users';
import { currentUser, requireAuth } from './components/users/routes/requireAuth';
import { endSession, refreshSession, startSession, type AuthResponse } from './components/users/services/sessionService';
import type { SessionRepo } from './components/users/store/types';
import type { Store } from './shared/store/types';
import { createServices } from './shared/services';

export interface AppDeps {
  sessions: SessionRepo;
  store?: Store;
  e2eRoutes?: boolean;
}

export function createApp({ sessions, store, e2eRoutes = false }: AppDeps): Express {
  const app = express();

  // The auth routes have tiny bodies; the limit rejects oversized ones early.
  app.use('/api/auth', express.json({ limit: '4kb' }));

  // Stays off the /api prefix: scripts/run-backend.sh and the Docker health
  // check poll /health directly.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Handlers return void rather than a promise so they can be passed straight
  // to Express.

  // POST /api/auth/google — verifies `{ idToken }` with Google and starts a
  // session. 400 if no token was sent, 401 if Google rejects it.
  app.post('/api/auth/google', (req, res) => {
    const { idToken } = (req.body ?? {}) as { idToken?: unknown };
    if (!isText(idToken)) {
      res.status(400).json({ error: 'Request body must contain an idToken' });
      return;
    }

    verifyGoogleIdToken(idToken).then(
      (user) => {
        sendAuth(res, startSession(sessions, user, store?.users));
      },
      (cause: unknown) => {
        console.error(`Google sign-in rejected: ${String(cause)}`);
        res.status(401).json({ error: 'Invalid or expired Google ID token' });
      }
    );
  });

  // POST /api/auth/refresh — trades `{ refreshToken }` for a new session token
  // and refresh token, without calling Google. 401 means sign in again.
  app.post('/api/auth/refresh', (req, res) => {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: unknown };
    if (!isText(refreshToken)) {
      res.status(400).json({ error: 'Request body must contain a refreshToken' });
      return;
    }

    sendAuth(res, refreshSession(sessions, refreshToken, store?.users));
  });

  // POST /api/auth/logout — revokes `{ refreshToken }` and every token from
  // the same sign-in. 204 even if it was already gone.
  app.post('/api/auth/logout', (req, res) => {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: unknown };
    if (!isText(refreshToken)) {
      res.status(400).json({ error: 'Request body must contain a refreshToken' });
      return;
    }

    endSession(sessions, refreshToken).then(
      () => {
        res.status(204).end();
      },
      (cause: unknown) => {
        sendServerError(res, cause);
      }
    );
  });
  // An auth body over the 4 KB limit is the client's mistake: 413, not 500.
  app.use('/api/auth', ratingBodyTooLarge);

  // Posts carry photo ids and fields, so they get a larger body limit.
  if (store !== undefined) {
    const events = new EventHub();
    const services = createServices(store, events);
    const posts = [express.json({ limit: '1mb' }), requireAuth];
    app.use('/api/feed', requireAuth, createFeedRouter(services.feed));
    app.use('/api/deals', requireAuth, createDealsRouter(services.deals));
    app.use('/api/deals', express.json({ limit: '4kb' }), requireAuth, createRatingsRouter(services.deals), ratingBodyTooLarge);
    app.use('/api/users', requireAuth, createReputationRouter(services.deals));
    app.use('/api/users', express.json({ limit: '4kb' }), requireAuth, createUsersRouter(services.users), ratingBodyTooLarge);
    app.use('/api/listings', ...posts, createListingsRouter(services.posts));
    app.use('/api/requests', ...posts, createRequestsRouter(services.posts));
    app.use('/api/options', ...posts, createOptionsRouter(services.posts));
    app.use('/api/custom-fields', ...posts, createCustomFieldsRouter(services.posts));
    app.use('/api/photos', createPhotosRouter(services.posts));
    // GET /api/events — the caller's live updates as Server-Sent Events; the response stays open.
    app.get('/api/events', requireAuth, (_req, res) => {
      events.open(currentUser(res).id, res);
    });
    const conversationAuth = [express.json({ limit: '16kb' }), requireAuth];
    const conversationRoutes = [createConversationsRouter(services.messaging), createProposalsRouter(services.messaging), ratingBodyTooLarge];
    app.use('/api/conversations', ...conversationAuth, ...conversationRoutes);
    if (e2eRoutes) {
      app.use('/api/e2e', requireAuth, createE2eRouter(store));
      app.use('/api/e2e/partner/conversations', ...conversationAuth, createE2ePartnerRouter(services.messaging, store), ratingBodyTooLarge);
    }
  }

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  app.use(errorHandler);

  return app;
}

// 200 with the tokens, 401 if the refresh token was rejected (null), or 500
// if the session store failed.
function sendAuth(res: Response, pending: Promise<AuthResponse | null>): void {
  pending.then(
    (result) => {
      if (result === null) {
        res.status(401).json({ error: 'Invalid or expired refresh token' });
      } else {
        res.json(result);
      }
    },
    (cause: unknown) => {
      sendServerError(res, cause);
    }
  );
}

function sendServerError(res: Response, cause: unknown): void {
  console.error(`Session store failed: ${String(cause)}`);
  res.status(500).json({ error: 'Internal Server Error' });
}
