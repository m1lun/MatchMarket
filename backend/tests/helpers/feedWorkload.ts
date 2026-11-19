import { CONDITIONS, type PostField, type RequestField } from '../../src/models/common';
import type { BuyerRequest } from '../../src/models/request';
import type { Store } from '../../src/store/types';
import { ME, OTHER, makeListing, makeRequest } from './dealFixtures';

// The NFR workload: 1,000 open candidate posts in the same category as my request.
export const CANDIDATES = 1000;
// Inserting in batches keeps the setup quick without opening 1,000 connections at once.
const INSERT_BATCH = 100;
const BRANDS = ['ikea', 'hay', 'muji', 'herman miller'];
const COLOURS = ['oak', 'black', 'white', 'red', 'blue'];

function soft(key: string, value: string | number, importance: number): RequestField {
  return { key, label: key, kind: 'builtin', type: typeof value === 'number' ? 'number' : 'text', value, hard: false, importance };
}

function textField(key: string, value: string): PostField {
  return { key, label: key, kind: 'builtin', type: 'text', value };
}

// Listing number i: every one meets the request's hard requirements, so all 1,000 are ranked,
// but prices, conditions, places, brands and colours vary so the scores differ.
function candidate(i: number): Parameters<typeof makeListing>[2] {
  return {
    price: 10 + (i % 90),
    condition: CONDITIONS[i % CONDITIONS.length] ?? 'good',
    // A grid about 3.6 km by 1.5 km around the request, inside its 10 km radius.
    location: { type: 'Point', coordinates: [-123.25 + (i % 50) * 0.001, 49.26 + Math.floor(i / 50) * 0.0007] },
    listingFields: [textField('brand', BRANDS[i % BRANDS.length] ?? 'ikea'), textField('colour', COLOURS[i % COLOURS.length] ?? 'oak')],
  };
}

// Saves another user's 1,000 open chair listings and my chair request with a hard maximum of $100
// and soft preferences for condition, brand and colour. A failed insert rejects, which fails the test.
export async function saveFeedWorkload(store: Store): Promise<BuyerRequest> {
  for (let start = 0; start < CANDIDATES; start += INSERT_BATCH) {
    const batch = Array.from({ length: INSERT_BATCH }, (_unused, offset) => makeListing(store, OTHER, candidate(start + offset)));
    await Promise.all(batch);
  }
  return makeRequest(store, ME, {
    requestFields: [
      { key: 'price', label: 'price', kind: 'builtin', type: 'number', value: 100, hard: true },
      soft('condition', 'good', 4),
      soft('brand', 'ikea', 5),
      soft('colour', 'oak', 2),
    ],
  });
}
