import express, { type Express, type Response } from 'express';

import { errorHandler, errorMessage } from './errors';
import { EventHub } from './events';
import { verifyGoogleIdToken } from './googleAuth';
import { isText } from './routes/checks';
import { createConversationsRouter } from './routes/conversations';
import { createCustomFieldsRouter } from './routes/customFields';
import { createDealsRouter } from './routes/deals';
import { createE2eRouter } from './routes/e2e';
import { createFeedRouter } from './routes/feed';
import { createListingsRouter } from './routes/listings';
import { createPhotosRouter } from './routes/photos';
import { createRatingsRouter, createReputationRouter, ratingBodyTooLarge } from './routes/ratings';
import { createOptionsRouter } from './routes/options';
import { createProposalsRouter } from './routes/proposals';
import { createRequestsRouter } from './routes/requests';
import { createUsersRouter } from './routes/users';
import { currentUser, endSession, refreshSession, requireAuth, startSession, type AuthResponse } from './sessions';
import type { SessionRepo, Store } from './store/types';

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
        console.error(`Google sign-in rejected: ${errorMessage(cause)}`);
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

  // Posts carry photo ids and fields, so they get a larger body limit.
  if (store !== undefined) {
    const posts = [express.json({ limit: '1mb' }), requireAuth];
    app.use('/api/feed', requireAuth, createFeedRouter(store));
    app.use('/api/deals', requireAuth, createDealsRouter(store));
    app.use('/api/deals', express.json({ limit: '4kb' }), requireAuth, createRatingsRouter(store), ratingBodyTooLarge);
    app.use('/api/users', requireAuth, createReputationRouter(store));
    app.use('/api/users', express.json({ limit: '4kb' }), requireAuth, createUsersRouter(store));
    app.use('/api/listings', ...posts, createListingsRouter(store));
    app.use('/api/requests', ...posts, createRequestsRouter(store));
    app.use('/api/options', ...posts, createOptionsRouter(store));
    app.use('/api/custom-fields', ...posts, createCustomFieldsRouter(store));
    app.use('/api/photos', createPhotosRouter(store.photos));
    const events = new EventHub();
    // GET /api/events — the caller's live updates as Server-Sent Events; the response stays open.
    app.get('/api/events', requireAuth, (_req, res) => {
      events.open(currentUser(res).id, res);
    });
    app.use(
      '/api/conversations',
      express.json({ limit: '16kb' }),
      requireAuth,
      createConversationsRouter(store, events),
      createProposalsRouter(store, events),
      ratingBodyTooLarge,
    );
    if (e2eRoutes) {
      app.use('/api/e2e', requireAuth, createE2eRouter(store));
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
  console.error(`Session store failed: ${errorMessage(cause)}`);
  res.status(500).json({ error: 'Internal Server Error' });
}
