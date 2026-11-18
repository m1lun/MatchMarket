import { randomUUID } from 'node:crypto';
import os from 'node:os';

import { MongoClient, type Db, type MongoClientOptions } from 'mongodb';

import { createMongoStore } from '../../src/store/mongoStore';
import type { Store } from '../../src/store/types';

const TEST_MONGODB_URI: string = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true';
const REACH_TIMEOUT_MS = 3000;

// Jest cannot run the driver's dynamic import('os'), so the handshake fails without this.
const CLIENT_OPTIONS: MongoClientOptions = { runtimeAdapters: { os } };

export interface TestStore {
  store: Store;
  db: Db;
  dropAndClose: () => Promise<void>;
}

// A real store on a fresh database of its own.
export async function createTestStore(): Promise<TestStore> {
  const client = new MongoClient(TEST_MONGODB_URI, { ...CLIENT_OPTIONS, serverSelectionTimeoutMS: REACH_TIMEOUT_MS });
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
  } catch (cause) {
    await client.close();
    throw new Error(
      `MongoDB is not reachable at ${TEST_MONGODB_URI}. Run the tests with ` +
        'scripts/run-backend-interface-tests.sh, or start one with: ' +
        'docker compose -f docker-compose.test.yml up -d --wait',
      { cause }
    );
  }

  const dbName = `matchmarket_test_${randomUUID().replaceAll('-', '')}`;
  const store = await createMongoStore(TEST_MONGODB_URI, dbName, CLIENT_OPTIONS);
  return {
    store,
    db: client.db(dbName),
    dropAndClose: async () => {
      await store.close();
      await client.db(dbName).dropDatabase();
      await client.close();
    },
  };
}
