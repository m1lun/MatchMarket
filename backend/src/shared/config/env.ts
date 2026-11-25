import 'dotenv/config';

const rawPort = process.env.PORT;
const port =
  rawPort === undefined || rawPort === ''
    ? 3000
    : Number.parseInt(rawPort, 10);

if (Number.isNaN(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT: ${rawPort}`);
}

function required(name: string, raw: string | undefined): string {
  const value = raw?.trim();
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const mongoDb = process.env.MONGODB_DB?.trim();

// M1 requires the app to reach the backend over HTTPS. Set ENABLE_HTTPS=true
// with a certificate and key in backend/certs/ (see README); local development
// stays on plain HTTP.
const httpsEnabled = process.env.ENABLE_HTTPS?.trim().toLowerCase() === 'true';

// The Web OAuth client ID that Google ID tokens must be issued to. The server
// rejects any token minted for a different client, so it refuses to start
// without one. Not a secret: the same value ships inside the APK.
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();

if (googleClientId === undefined || googleClientId === '') {
  throw new Error(
    'GOOGLE_CLIENT_ID is not set. Copy backend/.env.example to backend/.env ' +
      'and set it to the Web OAuth client ID (see README).'
  );
}

// Signs the backend's own session tokens (see src/sessions.ts). Anyone holding
// it can mint a session for any user, so it is a real secret: generate one per
// server (`openssl rand -base64 48`) and never commit it.
const jwtSecret = process.env.JWT_SECRET?.trim() ?? '';

if (jwtSecret.length < 32) {
  throw new Error(
    'JWT_SECRET must be at least 32 characters. Generate one with ' +
      '`openssl rand -base64 48` and put it in backend/.env (see README).'
  );
}

// The OpenRouteService API key for travel times. Optional: without it the feed is
// returned without travel times, as when the service is down.
const orsApiKey = process.env.ORS_API_KEY?.trim();

// Enables the test-only /api/e2e routes.
const e2eRoutes = process.env.ENABLE_E2E_ROUTES?.trim().toLowerCase() === 'true';

export const env = {
  port,
  mongoUri: required('MONGODB_URI', process.env.MONGODB_URI),
  mongoDb: mongoDb === undefined || mongoDb === '' ? 'matchmarket' : mongoDb,
  httpsEnabled,
  googleClientId,
  jwtSecret,
  orsApiKey: orsApiKey === undefined || orsApiKey === '' ? undefined : orsApiKey,
  e2eRoutes,
} as const;
