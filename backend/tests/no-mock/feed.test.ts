import type { Server } from 'node:http';

import request from 'supertest';

import { env } from '../../src/shared/config/env';
import type { Dimensions, FieldValue, GeoPoint, PostField, RequestField } from '../../src/shared/models/common';
import { ME, OTHER, bearer, clearDealData, makeListing, makeRequest } from '../helpers/dealFixtures';
import { startTestApp, stopTestApp } from '../helpers/testApp';
import { createTestStore, type TestStore } from '../helpers/testStore';

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
  // Without a key the feed never calls the routing service; the mocked tests cover travel times.
  jest.replaceProperty(env, 'orsApiKey', undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const UNKNOWN_ID = '6ad40b88e74dd3678bfef8f3';
// The fixtures' location is (49.26, -123.25). This point is about 18 km east of it,
// outside the default 10 km radius.
const FAR_AWAY: GeoPoint = { type: 'Point', coordinates: [-123.0, 49.26] };

interface QueryCase { label: string; query: string; details: string[] }
interface TokenCase { label: string; header: string | undefined; error: string }
interface Match { post: { id: string }; distanceKm: number; travelMinutes: number | null }
interface FeedBody { matches: Match[]; travelMode: string; travelTimesAvailable: boolean; nextCursor: string | null }
interface BrowseBody { listings?: { id: string }[]; requests?: { id: string }[]; nextCursor: string | null }

function hardField(key: string, value: FieldValue, type: PostField['type']): RequestField {
  return { key, label: key, kind: 'builtin', type, value, hard: true };
}

function customHard(key: string, value: FieldValue, type: PostField['type']): RequestField {
  return { ...hardField(key, value, type), kind: 'custom' };
}

function listingField(key: string, value: FieldValue, type: PostField['type'], kind: PostField['kind'] = 'builtin'): PostField {
  return { key, label: key, kind, type, value };
}

function dimensions(width: number, height: number, depth: number): Dimensions {
  return { width, height, depth };
}

const BUDGET_50 = hardField('price', 50, 'number');

function getFeed(query: string, userId = ME): request.Test {
  return request(app).get(`/api/feed?${query}`).set('Authorization', bearer(userId));
}

function matchIds(body: unknown): string[] {
  return (body as FeedBody).matches.map((match) => match.post.id);
}

function browseIds(body: unknown, key: 'listings' | 'requests'): string[] {
  const page = body as BrowseBody;
  return ((key === 'listings' ? page.listings : page.requests) ?? []).map((post) => post.id);
}

// Requests every route in this file must refuse before reading the database.
const TOKEN_CASES: TokenCase[] = [
  { label: 'No Token', header: undefined, error: 'Missing Authorization: Bearer <session token> header' },
  { label: 'Garbage Token', header: 'Bearer not-a-token', error: 'Invalid or expired session token' },
];

// Filter parameters both feeds share, each with the error it gives.
const FILTER_CASES: QueryCase[] = [
  { label: 'Empty Category', query: 'category=%20', details: ['category must not be empty'] },
  { label: 'Negative Min Price', query: 'minPrice=-1', details: ['minPrice must be a number from 0 up'] },
  { label: 'Non-Numeric Max Price', query: 'maxPrice=cheap', details: ['maxPrice must be a number from 0 up'] },
  { label: 'Min Price Over Max Price', query: 'minPrice=20&maxPrice=10', details: ['minPrice must not be more than maxPrice'] },
  { label: 'Latitude Without Longitude Or Radius', query: 'lat=49.26', details: ['lat, lng and radiusKm must be sent together'] },
  { label: 'Latitude Out Of Range', query: 'lat=91&lng=-123.25&radiusKm=5', details: ['lat must be a number from -90 to 90'] },
  { label: 'Longitude Out Of Range', query: 'lat=49.26&lng=181&radiusKm=5', details: ['lng must be a number from -180 to 180'] },
  { label: 'Radius Over 100 km', query: 'lat=49.26&lng=-123.25&radiusKm=101', details: ['radiusKm must be a number from 0 to 100'] },
];

// Interface GET /api/feed
describe('Unmocked: GET /api/feed', () => {
  // Input: GET /api/feed for my request with no Authorization header, or with a token that is not a valid JWT
  // Expected status code: 401
  // Expected behavior: the request is rejected before the database is read
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ header, error }: TokenCase) => {
    const buyerRequest = await makeRequest(mongo.store, ME);
    const call = request(app).get(`/api/feed?postId=${buyerRequest.id}`);

    const response = await (header === undefined ? call : call.set('Authorization', header));

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
  });

  // Input: a missing or malformed postId, a limit or cursor that is not a page from this API, an unsupported
  // parameter, or an invalid feed filter, each alongside the id of my open request where it is not the error
  // Expected status code: 400
  // Expected behavior: nothing is read from the database
  // Expected output: { error: 'Invalid request', details } naming every problem
  test.each([
    { label: 'Missing Post Id', query: '', details: ['postId must be the id of one of your requests or listings'] },
    { label: 'Malformed Post Id', query: 'postId=abc', details: ['postId must be the id of one of your requests or listings'] },
    { label: 'Limit Of 0', query: 'limit=0', details: ['limit must be a whole number from 1 to 50'] },
    { label: 'Limit Of 51', query: 'limit=51', details: ['limit must be a whole number from 1 to 50'] },
    { label: 'Non-Numeric Limit', query: 'limit=ten', details: ['limit must be a whole number from 1 to 50'] },
    { label: 'Non-Numeric Cursor', query: 'cursor=next', details: ['cursor must be the nextCursor from a previous page'] },
    { label: 'Unsupported Parameter', query: 'sort=price', details: ['unsupported parameter "sort"'] },
    { label: 'Browse Cursor', query: `before=${UNKNOWN_ID}`, details: ['unsupported parameter "before"'] },
    ...FILTER_CASES,
  ])('$label: 400', async ({ label, query, details }: QueryCase) => {
    const buyerRequest = await makeRequest(mongo.store, ME);
    const postId = label.includes('Post Id') ? '' : `postId=${buyerRequest.id}&`;

    const response = await getFeed(`${postId}${query}`);

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Invalid request', details });
  });

  // Input: several invalid parameters at once: a malformed postId, limit 0 and an unsupported parameter
  // Expected status code: 400
  // Expected behavior: every problem is reported together, so the client can fix them in one go
  // Expected output: { error: 'Invalid request', details } with all three
  test('Several Invalid Parameters: 400', async () => {
    const response = await getFeed('postId=abc&limit=0&page=2');

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({
      error: 'Invalid request',
      details: [
        'unsupported parameter "page"',
        'postId must be the id of one of your requests or listings',
        'limit must be a whole number from 1 to 50',
      ],
    });
  });

  // Input: a well-formed postId that is no request or listing
  // Expected status code: 404
  // Expected behavior: nothing is ranked
  // Expected output: { error: 'Not Found' }
  test('Unknown Post: 404', async () => {
    const response = await getFeed(`postId=${UNKNOWN_ID}`);

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
  });

  // Input: the id of another user's open request, and of another user's open listing
  // Expected status code: 403
  // Expected behavior: a user can only see recommendations for their own posts
  // Expected output: { error: 'Forbidden' }
  test.each([
    { label: 'Request', make: () => makeRequest(mongo.store, OTHER) },
    { label: 'Listing', make: () => makeListing(mongo.store, OTHER) },
  ])("Another User's $label: 403", async ({ make }: { label: string; make: () => Promise<{ id: string }> }) => {
    const post = await make();

    const response = await getFeed(`postId=${post.id}`);

    expect(response.status).toBe(403);
    expect(response.body).toStrictEqual({ error: 'Forbidden' });
  });

  // Input: the id of my closed request, which an open listing would otherwise match (Use Case 3, failure 1b)
  // Expected status code: 409
  // Expected behavior: a closed post has no feed
  // Expected output: { error: 'Closed posts have no feed' }
  test('Closed Post: 409', async () => {
    const closed = await makeRequest(mongo.store, ME, { status: 'closed' });
    await makeListing(mongo.store, OTHER);

    const response = await getFeed(`postId=${closed.id}`);

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual({ error: 'Closed posts have no feed' });
  });

  // Input: my request for a chair with a hard maximum of $50 and no radius field, and listings that are: a match,
  // my own, closed, in another category, over the budget, and about 18 km away
  // Expected status code: 200
  // Expected behavior: only other users' open listings in the same category, within the default 10 km radius and
  // meeting every hard requirement are kept (Use Case 3, step 3); no travel times without a routing key
  // Expected output: only the matching listing, at 0 km, with travelMinutes null, travelMode walk,
  // travelTimesAvailable false and nextCursor null
  test('Request Feed Keeps Only Listings That Meet The Hard Requirements', async () => {
    const buyerRequest = await makeRequest(mongo.store, ME);
    const match = await makeListing(mongo.store, OTHER, { price: 50 });
    await makeListing(mongo.store, ME);
    await makeListing(mongo.store, OTHER, { status: 'closed' });
    await makeListing(mongo.store, OTHER, { category: 'lamp' });
    await makeListing(mongo.store, OTHER, { price: 51 });
    await makeListing(mongo.store, OTHER, { location: FAR_AWAY });

    const response = await getFeed(`postId=${buyerRequest.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      matches: [{ post: { id: match.id }, distanceKm: 0, travelMinutes: null }],
      travelMode: 'walk',
      travelTimesAvailable: false,
      nextCursor: null,
    });
    expect(matchIds(response.body)).toEqual([match.id]);
  });

  // Input: my request with a hard radius of 30 km, and a listing about 18 km away
  // Expected status code: 200
  // Expected behavior: the request's own radius replaces the 10 km default, and a hard radius is not
  // compared as a listing field
  // Expected output: the listing, about 18 km away
  test('Request Radius Replaces The Default', async () => {
    const buyerRequest = await makeRequest(mongo.store, ME, {
      requestFields: [BUDGET_50, hardField('radiuskm', 30, 'number')],
    });
    const far = await makeListing(mongo.store, OTHER, { location: FAR_AWAY });

    const response = await getFeed(`postId=${buyerRequest.id}`);

    expect(response.status).toBe(200);
    expect(matchIds(response.body)).toEqual([far.id]);
    expect((response.body as FeedBody).matches[0]?.distanceKm).toBeCloseTo(18.2, 0);
  });

  // Input: my request with a radius of 0 km, a listing at my exact location and one about 0.7 km away
  // Expected status code: 200
  // Expected behavior: only a listing at the same spot is within 0 km, and its distance scores 1 rather than
  // dividing by the zero radius
  // Expected output: only the listing at my location, with the same score it gets under the default radius
  test('Radius Of 0 Keeps Only The Same Spot', async () => {
    const zeroRadius = await makeRequest(mongo.store, ME, {
      requestFields: [BUDGET_50, hardField('radiuskm', 0, 'number')],
    });
    const defaultRadius = await makeRequest(mongo.store, ME);
    const here = await makeListing(mongo.store, OTHER);
    await makeListing(mongo.store, OTHER, { location: { type: 'Point', coordinates: [-123.24, 49.26] } });

    const zero = await getFeed(`postId=${zeroRadius.id}`);
    const usual = await getFeed(`postId=${defaultRadius.id}`);

    expect(zero.status).toBe(200);
    expect(matchIds(zero.body)).toEqual([here.id]);
    const scoreOf = (body: unknown): number | undefined =>
      (body as { matches: { post: { id: string }; score: number }[] }).matches.find((match) => match.post.id === here.id)?.score;
    expect(scoreOf(zero.body)).toBeCloseTo(scoreOf(usual.body) ?? Number.NaN);
  });

  // Input: my request with hard dimensions of 100×50×40 cm, and listings measuring 50×100×40, 100×60×40,
  // and none
  // Expected status code: 200
  // Expected behavior: an item fits in any orientation; a listing that leaves a hard field blank is left out
  // Expected output: only the 50×100×40 listing
  test('Hard Dimensions Fit In Any Orientation', async () => {
    const buyerRequest = await makeRequest(mongo.store, ME, {
      requestFields: [BUDGET_50, hardField('dimensions', dimensions(100, 50, 40), 'dimensions')],
    });
    const fits = await makeListing(mongo.store, OTHER, {
      listingFields: [listingField('dimensions', dimensions(50, 100, 40), 'dimensions')],
    });
    await makeListing(mongo.store, OTHER, { listingFields: [listingField('dimensions', dimensions(100, 60, 40), 'dimensions')] });
    await makeListing(mongo.store, OTHER);

    const response = await getFeed(`postId=${buyerRequest.id}`);

    expect(response.status).toBe(200);
    expect(matchIds(response.body)).toEqual([fits.id]);
  });

  // Input: my request with a hard brand "IKEA" and a hard custom yes/no field "assembled", and listings with
  // brand "ikea" and assembled yes, brand "hay" and assembled yes, and brand "ikea" and assembled no
  // Expected status code: 200
  // Expected behavior: text is compared ignoring case and spacing; yes/no values must be equal
  // Expected output: only the first listing
  test('Hard Text And Yes/No Fields', async () => {
    const buyerRequest = await makeRequest(mongo.store, ME, {
      requestFields: [BUDGET_50, hardField('brand', 'IKEA', 'text'), customHard('assembled', true, 'bool')],
    });
    const fields = (brand: string, assembled: boolean): PostField[] => [
      listingField('brand', brand, 'text'),
      listingField('assembled', assembled, 'bool', 'custom'),
    ];
    const match = await makeListing(mongo.store, OTHER, { listingFields: fields(' ikea ', true) });
    await makeListing(mongo.store, OTHER, { listingFields: fields('hay', true) });
    await makeListing(mongo.store, OTHER, { listingFields: fields('ikea', false) });

    const response = await getFeed(`postId=${buyerRequest.id}`);

    expect(response.status).toBe(200);
    expect(matchIds(response.body)).toEqual([match.id]);
  });

  // Input: my $40 listing in good condition, and other users' requests with a hard maximum of $50, a hard maximum
  // of $30, and a hard minimum condition of like new
  // Expected status code: 200
  // Expected behavior: a listing's feed holds the requests it meets, by the same rule as a request's feed
  // Expected output: only the $50 request
  test('Listing Feed Holds The Requests It Meets', async () => {
    const listing = await makeListing(mongo.store, ME);
    const fits = await makeRequest(mongo.store, OTHER);
    await makeRequest(mongo.store, OTHER, { requestFields: [hardField('price', 30, 'number')] });
    await makeRequest(mongo.store, OTHER, { requestFields: [BUDGET_50, hardField('condition', 'like new', 'text')] });

    const response = await getFeed(`postId=${listing.id}`);

    expect(response.status).toBe(200);
    expect(matchIds(response.body)).toEqual([fits.id]);
  });

  // Input: my request, which no listing matches (Use Case 3, failure 3a)
  // Expected status code: 200
  // Expected behavior: an empty feed is not an error
  // Expected output: no matches, travelTimesAvailable false and nextCursor null
  test('No Matches', async () => {
    const buyerRequest = await makeRequest(mongo.store, ME);
    await makeListing(mongo.store, OTHER, { category: 'lamp' });

    const response = await getFeed(`postId=${buyerRequest.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ matches: [], travelMode: 'walk', travelTimesAvailable: false, nextCursor: null });
  });

  // Input: my request, three matching listings at different distances, then pages of 2 using each nextCursor
  // Expected status code: 200
  // Expected behavior: matches are ranked before paging, so the pages follow the ranking with no overlap
  // Expected output: the two nearest with nextCursor "2", then the farthest with nextCursor null
  test('Pages Follow The Ranking', async () => {
    const buyerRequest = await makeRequest(mongo.store, ME);
    const third = await makeListing(mongo.store, OTHER, { location: { type: 'Point', coordinates: [-123.2, 49.26] } });
    const first = await makeListing(mongo.store, OTHER);
    const second = await makeListing(mongo.store, OTHER, { location: { type: 'Point', coordinates: [-123.24, 49.26] } });

    const firstPage = await getFeed(`postId=${buyerRequest.id}&limit=2`);
    const cursor = (firstPage.body as FeedBody).nextCursor ?? '';
    const secondPage = await getFeed(`postId=${buyerRequest.id}&limit=2&cursor=${cursor}`);

    expect(firstPage.status).toBe(200);
    expect(matchIds(firstPage.body)).toEqual([first.id, second.id]);
    expect(cursor).toBe('2');
    expect(secondPage.status).toBe(200);
    expect(matchIds(secondPage.body)).toEqual([third.id]);
    expect((secondPage.body as FeedBody).nextCursor).toBeNull();
  });

  // Input: my request with a $100 budget, matching listings at $20, $60 and $90 (the $90 one about 1.5 km away),
  // a $150 listing over the budget and a $50 listing about 18 km away, outside the default 10 km radius,
  // and feed filters: minPrice 50, maxPrice 70, both together, a 1 km radius around my location, another category,
  // and filters looser than the request (maxPrice 500 and a 50 km radius)
  // Expected status code: 200
  // Expected behavior: feed filters narrow the matches on top of the hard requirements (Use Case 3, step 3),
  // and a filter looser than the request is ignored
  // Expected output: the listings that pass each filter, best first; the looser filters return the three matches
  test('Feed Filters Narrow The Matches', async () => {
    const buyerRequest = await makeRequest(mongo.store, ME, { requestFields: [hardField('price', 100, 'number')] });
    const cheap = await makeListing(mongo.store, OTHER, { price: 20 });
    const middle = await makeListing(mongo.store, OTHER, { price: 60 });
    const dear = await makeListing(mongo.store, OTHER, { price: 90, location: { type: 'Point', coordinates: [-123.23, 49.26] } });
    await makeListing(mongo.store, OTHER, { price: 150 });
    await makeListing(mongo.store, OTHER, { price: 50, location: FAR_AWAY });
    const feed = (filters: string): request.Test => getFeed(`postId=${buyerRequest.id}&${filters}`);

    const minimum = await feed('minPrice=50');
    const maximum = await feed('maxPrice=70');
    const range = await feed('minPrice=50&maxPrice=70');
    const near = await feed('lat=49.26&lng=-123.25&radiusKm=1');
    const otherCategory = await feed('category=Lamps');
    const looser = await feed('maxPrice=500&lat=49.26&lng=-123.25&radiusKm=50');

    for (const response of [minimum, maximum, range, near, otherCategory, looser]) {
      expect(response.status).toBe(200);
    }
    expect(new Set(matchIds(looser.body))).toEqual(new Set([cheap.id, middle.id, dear.id]));
    expect(new Set(matchIds(minimum.body))).toEqual(new Set([middle.id, dear.id]));
    expect(new Set(matchIds(maximum.body))).toEqual(new Set([cheap.id, middle.id]));
    expect(matchIds(range.body)).toEqual([middle.id]);
    expect(new Set(matchIds(near.body))).toEqual(new Set([cheap.id, middle.id]));
    expect(matchIds(otherCategory.body)).toEqual([]);
  });

  // Input: my $40 listing, a request with a $50 budget and a request with no budget, filtered by maxPrice 60
  // Expected status code: 200
  // Expected behavior: a request is filtered by its budget, and one with no budget fails any price filter
  // Expected output: only the request with a budget
  test('Price Filter On Requests Uses The Budget', async () => {
    const listing = await makeListing(mongo.store, ME);
    const withBudget = await makeRequest(mongo.store, OTHER);
    await makeRequest(mongo.store, OTHER, { requestFields: [] });

    const filtered = await getFeed(`postId=${listing.id}&maxPrice=60`);
    const unfiltered = await getFeed(`postId=${listing.id}`);

    expect(filtered.status).toBe(200);
    expect(matchIds(filtered.body)).toEqual([withBudget.id]);
    expect(matchIds(unfiltered.body)).toHaveLength(2);
  });
});

// The browse feeds share their code, so each describe group runs the same cases for its kind of post.
function browseTests(kind: 'listings' | 'requests'): void {
  const make = (ownerId: string, overrides: Record<string, unknown> = {}): Promise<{ id: string }> =>
    kind === 'listings' ? makeListing(mongo.store, ownerId, overrides) : makeRequest(mongo.store, ownerId, overrides);
  const browse = (query = ''): request.Test => request(app).get(`/api/feed/${kind}?${query}`).set('Authorization', bearer(ME));

  // Input: GET /api/feed/<kind> with no Authorization header, or with a token that is not a valid JWT
  // Expected status code: 401
  // Expected behavior: the request is rejected before the database is read
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ header, error }: TokenCase) => {
    const call = request(app).get(`/api/feed/${kind}`);

    const response = await (header === undefined ? call : call.set('Authorization', header));

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
  });

  // Input: a limit or before that is not a page from this API, a parameter only the ranked feed takes,
  // or an invalid feed filter (Use Case 5, failures 3a, 3b, 3c and 3d)
  // Expected status code: 400
  // Expected behavior: nothing is read from the database
  // Expected output: { error: 'Invalid request', details } naming the problem
  test.each([
    { label: 'Limit Of 51', query: 'limit=51', details: ['limit must be a whole number from 1 to 50'] },
    { label: 'Malformed Before', query: 'before=abc', details: ['before must be the nextCursor from a previous page'] },
    { label: 'Ranked Feed Parameter', query: `postId=${UNKNOWN_ID}`, details: ['unsupported parameter "postId"'] },
    ...FILTER_CASES,
  ])('$label: 400', async ({ query, details }: QueryCase) => {
    const response = await browse(query);

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Invalid request', details });
  });

  // Input: three of another user's open posts, one closed, and one of my own, then pages of 2 using each nextCursor
  // Expected status code: 200
  // Expected behavior: other users' open posts, newest first (Use Case 5, step 2), with no overlap between pages
  // Expected output: the two newest with nextCursor set to the second's id, then the oldest with nextCursor null
  test('Other Users\' Open Posts, Newest First, In Pages', async () => {
    const oldest = await make(OTHER);
    const middle = await make(OTHER);
    const newest = await make(OTHER);
    await make(OTHER, { status: 'closed' });
    await make(ME);

    const firstPage = await browse('limit=2');
    const secondPage = await browse(`limit=2&before=${String((firstPage.body as BrowseBody).nextCursor)}`);

    expect(firstPage.status).toBe(200);
    expect(browseIds(firstPage.body, kind)).toEqual([newest.id, middle.id]);
    expect((firstPage.body as BrowseBody).nextCursor).toBe(middle.id);
    expect(secondPage.status).toBe(200);
    expect(browseIds(secondPage.body, kind)).toEqual([oldest.id]);
    expect((secondPage.body as BrowseBody).nextCursor).toBeNull();
  });

  // Input: no other user's posts (Use Case 5, failure 5a)
  // Expected status code: 200
  // Expected behavior: an empty feed is not an error
  // Expected output: an empty list and nextCursor null
  test('No Posts', async () => {
    await make(ME);

    const response = await browse();

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ [kind]: [], nextCursor: null });
  });

  // Input: a chair and a lamp post, filtered by category "Chairs"
  // Expected status code: 200
  // Expected behavior: the category is normalised to its stored form, "chair", before filtering (Use Case 5, step 5)
  // Expected output: only the chair
  test('Category Filter', async () => {
    const chair = await make(OTHER);
    await make(OTHER, { category: 'lamp' });

    const response = await browse('category=Chairs');

    expect(response.status).toBe(200);
    expect(browseIds(response.body, kind)).toEqual([chair.id]);
  });

  // Input: posts at my location and about 18 km away, filtered to 10 km around my location
  // Expected status code: 200
  // Expected behavior: only posts within the radius are kept, still newest first
  // Expected output: only the nearby post
  test('Distance Filter', async () => {
    const near = await make(OTHER);
    await make(OTHER, { location: FAR_AWAY });

    const response = await browse('lat=49.26&lng=-123.25&radiusKm=10');

    expect(response.status).toBe(200);
    expect(browseIds(response.body, kind)).toEqual([near.id]);
  });
}

// Interface GET /api/feed/listings
describe('Unmocked: GET /api/feed/listings', () => {
  browseTests('listings');

  // Input: listings at $20, $60 and $90, filtered by minPrice 50 and maxPrice 70
  // Expected status code: 200
  // Expected behavior: a listing is filtered by its price, with both ends included
  // Expected output: only the $60 listing, and both edges of a $60-$60 range
  test('Price Filter', async () => {
    await makeListing(mongo.store, OTHER, { price: 20 });
    const middle = await makeListing(mongo.store, OTHER, { price: 60 });
    await makeListing(mongo.store, OTHER, { price: 90 });

    const range = await request(app).get('/api/feed/listings?minPrice=50&maxPrice=70').set('Authorization', bearer(ME));
    const exact = await request(app).get('/api/feed/listings?minPrice=60&maxPrice=60').set('Authorization', bearer(ME));

    expect(range.status).toBe(200);
    expect(exact.status).toBe(200);
    expect(browseIds(range.body, 'listings')).toEqual([middle.id]);
    expect(browseIds(exact.body, 'listings')).toEqual([middle.id]);
  });
});

// Interface GET /api/feed/requests
describe('Unmocked: GET /api/feed/requests', () => {
  browseTests('requests');

  // Input: requests with budgets of $30 and $50 and one with no budget, filtered by minPrice 40
  // Expected status code: 200
  // Expected behavior: a request is filtered by its budget, and one with no budget fails any price filter
  // Expected output: only the $50 request
  test('Budget Filter', async () => {
    await makeRequest(mongo.store, OTHER, { requestFields: [hardField('price', 30, 'number')] });
    const fifty = await makeRequest(mongo.store, OTHER);
    await makeRequest(mongo.store, OTHER, { requestFields: [] });

    const response = await request(app).get('/api/feed/requests?minPrice=40').set('Authorization', bearer(ME));

    expect(response.status).toBe(200);
    expect(browseIds(response.body, 'requests')).toEqual([fifty.id]);
  });
});
