import { normaliseStoredCategories, seedOptions } from '../../src/components/posts/store/seed';
import type { env as EnvValue } from '../../src/shared/config/env';
import type { Store } from '../../src/shared/store/types';

jest.mock('dotenv/config', () => ({}));

const FAILURE = new Error('MongoDB is unreachable');
const ORIGINAL_ENV = process.env;

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.restoreAllMocks();
  jest.resetModules();
  process.exitCode = undefined;
});

function setEnv(values: Record<string, string | undefined>): void {
  process.env = { ...ORIGINAL_ENV, ...values };
}

type Env = typeof EnvValue;

function loadEnv(values: Record<string, string | undefined>): Env {
  setEnv(values);
  let loaded: Env | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<{ env: Env }>('../../src/shared/config/env').env;
  });
  if (loaded === undefined) {
    throw new Error('env did not load');
  }
  return loaded;
}

// Runs at start-up, so no HTTP interface reaches it.
describe('Mocked: start-up configuration (env)', () => {
  // Mocked behavior: dotenv loads nothing, so only the variables set here are read
  // Input: no PORT, MONGODB_DB or ORS_API_KEY, then all three set
  // Expected status code: none, since the configuration is read at start-up rather than on a request
  // Expected behavior: unset optional values fall back to their defaults, and set ones are used
  // Expected output: port 3000, database matchmarket and no routing key; then port 8080, database other and the key
  test('Defaults And Set Values', () => {
    const defaults = loadEnv({ PORT: '', MONGODB_DB: undefined, ORS_API_KEY: undefined });
    const set = loadEnv({ PORT: '8080', MONGODB_DB: 'other', ORS_API_KEY: 'key' });
    const noPort = loadEnv({ PORT: undefined });

    expect(defaults).toMatchObject({ port: 3000, mongoDb: 'matchmarket', orsApiKey: undefined });
    expect(set).toMatchObject({ port: 8080, mongoDb: 'other', orsApiKey: 'key' });
    expect(noPort.port).toBe(3000);
  });

  // Mocked behavior: dotenv loads nothing, so only the variables set here are read
  // Input: an invalid PORT, no MONGODB_URI, no GOOGLE_CLIENT_ID, a JWT_SECRET under 32 characters, or no JWT_SECRET
  // Expected status code: none, since the configuration is read at start-up rather than on a request
  // Expected behavior: the server refuses to start
  // Expected output: an error naming the problem
  test.each([
    { label: 'Invalid PORT', values: { PORT: 'abc' }, error: 'Invalid PORT: abc' },
    { label: 'PORT Out Of Range', values: { PORT: '70000' }, error: 'Invalid PORT: 70000' },
    { label: 'No MONGODB_URI', values: { MONGODB_URI: undefined }, error: 'Missing required environment variable: MONGODB_URI' },
    { label: 'No GOOGLE_CLIENT_ID', values: { GOOGLE_CLIENT_ID: undefined }, error: 'GOOGLE_CLIENT_ID is not set' },
    { label: 'Short JWT_SECRET', values: { JWT_SECRET: 'short' }, error: 'JWT_SECRET must be at least 32 characters' },
    { label: 'No JWT_SECRET', values: { JWT_SECRET: undefined }, error: 'JWT_SECRET must be at least 32 characters' },
  ])('$label: Start-Up Fails', ({ values, error }: { label: string; values: Record<string, string | undefined>; error: string }) => {
    expect(() => loadEnv(values)).toThrow(error);
  });
});

interface FakeServer {
  listen: jest.Mock;
  close: jest.Mock;
  closeAllConnections: jest.Mock;
}

interface Started {
  store: { close: jest.Mock };
  http: jest.Mock;
  https: jest.Mock;
  server: FakeServer;
  signals: Map<string, () => void>;
  error: jest.SpyInstance;
}

function fakeServer(): FakeServer {
  return {
    listen: jest.fn((_port: number, ready: () => void) => {
      ready();
    }),
    close: jest.fn((done: () => void) => {
      done();
    }),
    closeAllConnections: jest.fn(),
  };
}

// Loads src/index.ts with MongoDB, the seed steps, the servers and the certificate files mocked.
async function start(options: { https?: boolean; mongoFails?: boolean; closeFails?: boolean } = {}): Promise<Started> {
  setEnv({ ENABLE_HTTPS: options.https === true ? 'true' : 'false', PORT: '4321' });
  const store = { close: jest.fn(async () => (options.closeFails === true ? Promise.reject(FAILURE) : Promise.resolve())) };
  const server = fakeServer();
  const http = jest.fn(() => server);
  const https = jest.fn(() => server);
  const signals = new Map<string, () => void>();
  jest.spyOn(process, 'on').mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
    signals.set(String(event), handler as () => void);
    return process;
  });
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await jest.isolateModulesAsync(async () => {
    jest.doMock('node:http', () => ({ ...jest.requireActual<object>('node:http'), createServer: http }));
    jest.doMock('node:https', () => ({ ...jest.requireActual<object>('node:https'), createServer: https }));
    jest.doMock('node:fs', () => ({ ...jest.requireActual<object>('node:fs'), readFileSync: jest.fn(() => Buffer.from('pem')) }));
    jest.doMock('../../src/app', () => ({ createApp: jest.fn(() => ({})) }));
    jest.doMock('../../src/shared/store/mongoStore', () => ({
      createMongoStore: jest.fn(async () => (options.mongoFails === true ? Promise.reject(FAILURE) : Promise.resolve(store))),
    }));
    jest.doMock('../../src/components/posts/store/seed', () => ({
      normaliseStoredCategories: jest.fn(async () => Promise.resolve()),
      seedOptions: jest.fn(async () => Promise.resolve()),
    }));
    jest.requireActual('../../src/index');
    await new Promise((resolve) => setImmediate(resolve));
  });
  return { store, http, https, server, signals, error };
}

// Runs at start-up, so no HTTP interface reaches it.
describe('Mocked: server start (index.ts)', () => {
  // Mocked behavior: MongoDB and the seed steps succeed, and the HTTP server is a fake
  // Input: ENABLE_HTTPS=false, then ENABLE_HTTPS=true
  // Expected status code: none, since this is the server starting rather than a request
  // Expected behavior: an HTTP server, or an HTTPS server with the certificate, listens on PORT
  // Expected output: listen called with 4321 on the right kind of server
  test.each([
    { label: 'HTTP', https: false },
    { label: 'HTTPS', https: true },
  ])('Starts Over $label', async ({ https }: { label: string; https: boolean }) => {
    const started = await start({ https });

    expect((https ? started.https : started.http)).toHaveBeenCalledTimes(1);
    expect((https ? started.http : started.https)).not.toHaveBeenCalled();
    expect(started.server.listen).toHaveBeenCalledWith(4321, expect.any(Function));
  });

  // Mocked behavior: createMongoStore rejects with Error('MongoDB is unreachable')
  // Input: start-up
  // Expected status code: none, since this is the server starting rather than a request
  // Expected behavior: the error is logged, no server is started, and the process will exit with 1
  // Expected output: process.exitCode 1
  test('MongoDB Fails: Exit Code 1', async () => {
    const started = await start({ mongoFails: true });

    expect(started.http).not.toHaveBeenCalled();
    expect(started.error).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });

  // Mocked behavior: the server is a fake; store.close resolves, or rejects with Error('MongoDB is unreachable')
  // Input: SIGTERM after start-up
  // Expected status code: none, since this is the server stopping rather than a request
  // Expected behavior: open connections are closed, the server stops, and MongoDB is closed; a failed close is logged
  // Expected output: process.exitCode unchanged, or 1 when MongoDB could not be closed
  test.each([
    { label: 'MongoDB Closes', closeFails: false, exitCode: undefined },
    { label: 'MongoDB Close Fails', closeFails: true, exitCode: 1 },
  ])('SIGTERM, $label', async ({ closeFails, exitCode }: { label: string; closeFails: boolean; exitCode: number | undefined }) => {
    const started = await start({ closeFails });

    started.signals.get('SIGTERM')?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(started.server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(started.server.close).toHaveBeenCalledTimes(1);
    expect(started.store.close).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(exitCode);
  });
});

// Runs at start-up, so no HTTP interface reaches it.
describe('Mocked: start-up data (seed)', () => {
  // Mocked behavior: options.ensureMany, or listings.listCategories, rejects with Error('MongoDB is unreachable')
  // Input: seedOptions, or normaliseStoredCategories, at start-up
  // Expected status code: none, since these run at start-up rather than on a request
  // Expected behavior: the error is wrapped with what failed, so start-up stops with a clear message
  // Expected output: an error 'Failed to seed built-in options' or 'Failed to normalise stored categories'
  test('Seeding Options Fails', async () => {
    const store = { options: { ensureMany: jest.fn(async () => Promise.reject(FAILURE)) } } as unknown as Store;

    await expect(seedOptions(store)).rejects.toThrow('Failed to seed built-in options');
  });

  test('Normalising Categories Fails', async () => {
    const failing = { listCategories: jest.fn(async () => Promise.reject(FAILURE)), renameCategory: jest.fn() };
    const store = { listings: failing, requests: failing, options: { list: jest.fn(async () => Promise.resolve([])) } } as unknown as Store;

    await expect(normaliseStoredCategories(store)).rejects.toThrow('Failed to normalise stored categories');
  });
});
