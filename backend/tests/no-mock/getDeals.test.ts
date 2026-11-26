import type { Server } from 'node:http';

import request from 'supertest';

import type { Deal } from '../../src/components/deals/models/deal';
import type { Listing } from '../../src/components/posts/models/listing';
import type { Rating } from '../../src/components/deals/models/rating';
import type { BuyerRequest } from '../../src/components/posts/models/request';
import {
  ME,
  OTHER,
  PHOTO_ID,
  STRANGER,
  bearer,
  clearDealData,
  makeDeal,
  makeListing,
  makeRating,
  makeReputation,
  makeRequest,
  makeUser,
} from '../helpers/dealFixtures';
import { startTestApp, stopTestApp } from '../helpers/testApp';
import { createTestStore, type TestStore } from '../helpers/testStore';

const SECOND_PHOTO_ID = '6ad40b88e74dd3678bfef8f4';

let mongo: TestStore;
let app: Server;

beforeAll(async () => {
  mongo = await createTestStore();
  app = await startTestApp(mongo.store);
});

afterAll(async () => {
  await stopTestApp(app);
  await mongo.dropAndClose();
});

beforeEach(async () => {
  await clearDealData(mongo.db);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function getDeals(query = '', userId = ME): request.Test {
  return request(app).get(`/api/deals${query}`).set('Authorization', bearer(userId));
}

async function dealOnNewListing(sellerId = ME, buyerId = OTHER): Promise<Deal> {
  const listing = await makeListing(mongo.store, sellerId);
  return makeDeal(mongo.store, { sellerId, buyerId }, { listingId: listing.id });
}

interface DealJson {
  id: string;
  title: string;
  listing: unknown;
  request: unknown;
  otherUser: unknown;
  myRating: unknown;
  theirRating: unknown;
}

function dealsOf(response: request.Response): DealJson[] {
  return (response.body as { deals: DealJson[] }).deals;
}

function ratingJson(rating: Rating): { stars: number; comment: string; createdAt: string } {
  return { stars: rating.stars, comment: rating.comment, createdAt: rating.createdAt.toISOString() };
}

interface TokenCase { label: string; header: string | undefined; error: string }
interface RoleCase {
  label: string;
  sellerId: string;
  buyerId: string;
  role: string;
  otherStars: number[];
  score: number | null;
  ratingCount: number;
}
interface PostsCase { label: string; listing: boolean; request: boolean; title: string }
interface RatedCase { label: string; byMe: boolean; byThem: boolean }
interface GoneCase { label: string; post: 'listings' | 'requests' }
interface QueryCase { label: string; query: string; details: string[] }

const LIMIT_ERROR = 'limit must be a whole number from 1 to 50';
const BEFORE_ERROR = 'before must be the nextCursor from a previous page';

// Interface GET /api/deals
describe('Unmocked: GET /api/deals', () => {
  // Input: GET request with no Authorization header, or with a token that is not a valid JWT (see table)
  // Expected status code: 401
  // Expected behavior: request is rejected before the database is read
  // Expected output: { error } naming the auth problem
  test.each([
    { label: 'No Token', header: undefined, error: 'Missing Authorization: Bearer <session token> header' },
    { label: 'Garbage Token', header: 'Bearer not-a-token', error: 'Invalid or expired session token' },
  ])('$label: 401', async ({ header, error }: TokenCase) => {
    const call = request(app).get('/api/deals');
    const response = await (header === undefined ? call : call.set('Authorization', header));

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
  });

  // Input: GET /api/deals as a user who has no deals
  // Expected status code: 200
  // Expected behavior: nothing is returned and no next page is offered
  // Expected output: { deals: [], nextCursor: null }
  test('No Deals', async () => {
    const response = await getDeals();

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ deals: [], nextCursor: null });
  });

  // Input: GET /api/deals as the seller, or as the buyer when the seller has ratings [5, 4]
  // Expected status code: 200
  // Expected behavior: caller's role is reported and otherUser is the other party with their name and score
  // Expected output: one deal with role, the listing's name as title, listing, request: null, otherUser and null ratings
  test.each([
    { label: 'Seller', sellerId: ME, buyerId: OTHER, role: 'seller', otherStars: [], score: null, ratingCount: 0 },
    { label: 'Buyer', sellerId: OTHER, buyerId: ME, role: 'buyer', otherStars: [5, 4], score: 4.5, ratingCount: 2 },
  ])('Caller Is The $label', async ({ sellerId, buyerId, role, otherStars, score, ratingCount }: RoleCase) => {
    const other = role === 'seller' ? buyerId : sellerId;
    await makeReputation(mongo.store, other, otherStars);
    await makeUser(mongo.store, other, 'Jane', 'Doe');
    const listing = await makeListing(mongo.store, sellerId, { name: 'IKEA oak chair' });
    const deal = await makeDeal(mongo.store, { sellerId, buyerId }, { listingId: listing.id });

    const response = await getDeals();

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      deals: [
        {
          id: deal.id,
          role,
          agreedPrice: 40,
          createdAt: deal.createdAt.toISOString(),
          title: 'IKEA oak chair',
          listing: { id: listing.id, category: 'chair', price: 40, photoId: PHOTO_ID },
          request: null,
          otherUser: { id: other, score, ratingCount, firstName: 'Jane', lastName: 'Doe' },
          myRating: null,
          theirRating: null,
        },
      ],
      nextCursor: null,
    });
  });

  // Input: a deal whose other user has no saved profile
  // Expected status code: 200
  // Expected behavior: the deal is still returned rather than failing
  // Expected output: otherUser with firstName: '' and lastName: ''
  test('Other User Has No Profile', async () => {
    await dealOnNewListing();

    const response = await getDeals();

    expect(response.status).toBe(200);
    expect(dealsOf(response)).toMatchObject([
      { otherUser: { id: OTHER, score: null, ratingCount: 0, firstName: '', lastName: '' } },
    ]);
  });

  // Input: GET /api/deals as ME when the only deal is between OTHER and STRANGER
  // Expected status code: 200
  // Expected behavior: deals the caller is not part of are not returned
  // Expected output: { deals: [], nextCursor: null }
  test('Other Users Deals Are Hidden', async () => {
    await dealOnNewListing(OTHER, STRANGER);

    const response = await getDeals();

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ deals: [], nextCursor: null });
  });

  // Input: 5 deals, fetched with limit=2 and then before=<nextCursor> twice
  // Expected status code: 200
  // Expected behavior: deals come newest first with none repeated or skipped
  // Expected output: pages of 2, 2 and 1 deals; the last nextCursor is null
  test('Pages Newest First', async () => {
    const made: Deal[] = [];
    for (let count = 0; count < 5; count += 1) {
      made.push(await dealOnNewListing());
    }
    const newest = made.map((deal) => deal.id).reverse();

    const page1 = await getDeals('?limit=2');
    const page2 = await getDeals(`?limit=2&before=${newest[1]}`);
    const page3 = await getDeals(`?limit=2&before=${newest[3]}`);

    const idsOf = (response: request.Response): string[] => dealsOf(response).map((deal) => deal.id);
    expect(idsOf(page1)).toStrictEqual(newest.slice(0, 2));
    expect(page1.body).toMatchObject({ nextCursor: newest[1] });
    expect(idsOf(page2)).toStrictEqual(newest.slice(2, 4));
    expect(page2.body).toMatchObject({ nextCursor: newest[3] });
    expect(idsOf(page3)).toStrictEqual(newest.slice(4));
    expect(page3.body).toMatchObject({ nextCursor: null });
  });

  // Input: 2 deals, fetched with limit=2
  // Expected status code: 200
  // Expected behavior: no next page is offered when the last deal is on this page
  // Expected output: 2 deals and nextCursor: null
  test('Page That Fits Exactly', async () => {
    await dealOnNewListing();
    await dealOnNewListing();

    const response = await getDeals('?limit=2');

    expect(response.status).toBe(200);
    expect(dealsOf(response)).toHaveLength(2);
    expect(response.body).toMatchObject({ nextCursor: null });
  });

  // Input: a deal with a listing and a request, a listing only, or a request only
  // Expected status code: 200
  // Expected behavior: title is the listing's name when there is one, otherwise the request's name
  // Expected output: deal with title, and listing and request summaries or null
  test.each([
    { label: 'A Listing And A Request', listing: true, request: true, title: 'Chair' },
    { label: 'A Listing Only', listing: true, request: false, title: 'Chair' },
    { label: 'A Request Only', listing: false, request: true, title: 'Standing desk' },
  ])('Deal From $label', async ({ listing: withListing, request: withRequest, title }: PostsCase) => {
    const listing: Listing | undefined = withListing ? await makeListing(mongo.store, ME) : undefined;
    const buyerRequest: BuyerRequest | undefined = withRequest
      ? await makeRequest(mongo.store, OTHER, { name: 'Standing desk', category: 'desk', photoIds: [PHOTO_ID, SECOND_PHOTO_ID] })
      : undefined;
    await makeDeal(mongo.store, { sellerId: ME, buyerId: OTHER }, { listingId: listing?.id, requestId: buyerRequest?.id });

    const response = await getDeals();

    expect(response.status).toBe(200);
    expect(dealsOf(response)).toMatchObject([
      {
        title,
        listing: listing === undefined ? null : { id: listing.id, category: 'chair', price: 40, photoId: PHOTO_ID },
        request: buyerRequest === undefined ? null : { id: buyerRequest.id, category: 'desk', photoId: PHOTO_ID },
      },
    ]);
  });

  // Input: a deal whose request has no photos
  // Expected status code: 200
  // Expected behavior: a missing photo is not an error
  // Expected output: request summary with photoId: null
  test('Request Without A Photo', async () => {
    const buyerRequest = await makeRequest(mongo.store, OTHER, { photoIds: [] });
    await makeDeal(mongo.store, { sellerId: ME, buyerId: OTHER }, { requestId: buyerRequest.id });

    const response = await getDeals();

    expect(response.status).toBe(200);
    expect(dealsOf(response)).toMatchObject([{ request: { id: buyerRequest.id, category: 'chair', photoId: null } }]);
  });

  // Input: a deal rated by nobody, by ME, by OTHER, or by both
  // Expected status code: 200
  // Expected behavior: each rating is reported on the correct side
  // Expected output: myRating and theirRating, each { stars, comment, createdAt } or null
  test.each([
    { label: 'Nobody Has Rated', byMe: false, byThem: false },
    { label: 'Only I Rated', byMe: true, byThem: false },
    { label: 'Only They Rated', byMe: false, byThem: true },
    { label: 'Both Rated', byMe: true, byThem: true },
  ])('$label', async ({ byMe, byThem }: RatedCase) => {
    const deal = await dealOnNewListing();
    const mine = byMe
      ? await makeRating(mongo.store, { dealId: deal.id, raterId: ME, ratedUserId: OTHER, stars: 4, comment: 'Smooth' })
      : undefined;
    const theirs = byThem
      ? await makeRating(mongo.store, { dealId: deal.id, raterId: OTHER, ratedUserId: ME, stars: 2, comment: 'Late' })
      : undefined;

    const response = await getDeals();

    expect(response.status).toBe(200);
    expect(dealsOf(response)).toMatchObject([
      {
        myRating: mine === undefined ? null : ratingJson(mine),
        theirRating: theirs === undefined ? null : ratingJson(theirs),
      },
    ]);
  });

  // Input: a deal whose listing or request was deleted from the database
  // Expected status code: 200
  // Expected behavior: the deal is still returned rather than failing
  // Expected output: deal with title: '', listing: null, request: null
  test.each<GoneCase>([
    { label: 'Listing', post: 'listings' },
    { label: 'Request', post: 'requests' },
  ])('Deleted $label', async ({ post }: GoneCase) => {
    const listing = post === 'listings' ? await makeListing(mongo.store, ME) : undefined;
    const buyerRequest = post === 'requests' ? await makeRequest(mongo.store, OTHER) : undefined;
    const deal = await makeDeal(mongo.store, { sellerId: ME, buyerId: OTHER }, { listingId: listing?.id, requestId: buyerRequest?.id });
    await mongo.db.collection(post).deleteMany({});

    const response = await getDeals();

    expect(response.status).toBe(200);
    expect(dealsOf(response)).toMatchObject([{ id: deal.id, title: '', listing: null, request: null }]);
  });

  // Input: limit=1 and limit=50, the smallest and largest allowed values
  // Expected status code: 200
  // Expected behavior: limit is accepted
  // Expected output: the 1 stored deal
  test.each(['1', '50'])('Limit %s Is Allowed', async (limit) => {
    await dealOnNewListing();

    const response = await getDeals(`?limit=${limit}`);

    expect(response.status).toBe(200);
    expect(dealsOf(response)).toHaveLength(1);
  });

  // Input: an invalid limit or before, an operator in a parameter name, or an unknown parameter (see table)
  // Expected status code: 400
  // Expected behavior: request is rejected and no deals are returned
  // Expected output: { error: 'Invalid request', details } naming the bad parameter
  test.each([
    { label: 'Limit 0', query: '?limit=0', details: [LIMIT_ERROR] },
    { label: 'Limit 51', query: '?limit=51', details: [LIMIT_ERROR] },
    { label: 'Limit Not A Number', query: '?limit=abc', details: [LIMIT_ERROR] },
    { label: 'Limit Negative', query: '?limit=-1', details: [LIMIT_ERROR] },
    { label: 'Limit Fractional', query: '?limit=1.5', details: [LIMIT_ERROR] },
    { label: 'Limit Repeated', query: '?limit=1&limit=2', details: [LIMIT_ERROR] },
    { label: 'Before Repeated', query: '?before=nope&before=nope', details: [BEFORE_ERROR] },
    { label: 'Before Not An Id', query: '?before=nope', details: [BEFORE_ERROR] },
    { label: 'Before Operator', query: '?before[$ne]=x', details: ['unsupported parameter "before[$ne]"'] },
    { label: 'Unknown Parameter', query: '?sort=asc', details: ['unsupported parameter "sort"'] },
  ])('$label: 400', async ({ query, details }: QueryCase) => {
    const response = await getDeals(query);

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Invalid request', details });
  });
});
