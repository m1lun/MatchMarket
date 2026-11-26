import type { Server } from 'node:http';

import request from 'supertest';

import { MAX_ADDRESS_LENGTH, type GeoPoint } from '../../src/shared/models/common';
import { TOKEN_CASES, type TokenCase } from '../helpers/conversationFixtures';
import { ME, STRANGER, bearer, clearDealData, makeUser } from '../helpers/dealFixtures';
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
  await makeUser(mongo.store, ME, 'Terry', 'Teh');
});

interface InvalidCase { label: string; body: unknown; details: string[] }
interface UnreadableCase { label: string; raw: string; status: number; expected: unknown }

// The 4 KB body limit of the /api/users routes in app.ts.
const BODY_LIMIT = 4 * 1024;

// The body the app sends to save an address, and how the address is stored and returned.
const HOME = { address: '2329 West Mall, Vancouver', location: { longitude: -123.25, latitude: 49.26 } };
const STORED_HOME: { address: string; location: GeoPoint } = {
  address: HOME.address,
  location: { type: 'Point', coordinates: [-123.25, 49.26] },
};

// ME as makeUser saves them; the dates are only checked to be present, since the store sets them.
const PROFILE = {
  id: ME,
  firstName: 'Terry',
  lastName: 'Teh',
  email: `${ME}@example.com`,
  pictureUrl: null,
  createdAt: expect.any(String) as unknown,
  updatedAt: expect.any(String) as unknown,
};

function getMe(auth: string | null = bearer(ME)): request.Test {
  const call = request(app).get('/api/users/me');
  return auth === null ? call : call.set('Authorization', auth);
}

function patchMe(body: unknown, auth: string | null = bearer(ME)): request.Test {
  const call = request(app).patch('/api/users/me');
  return (auth === null ? call : call.set('Authorization', auth)).send(body as object);
}

function patchMeRaw(raw: string): request.Test {
  return request(app).patch('/api/users/me').set('Authorization', bearer(ME)).set('Content-Type', 'application/json').send(raw);
}

async function saveHome(): Promise<void> {
  await mongo.store.users.updateAddress(ME, STORED_HOME);
}

// The user's stored address and location: {} when neither is set, null when the user does not exist.
async function storedPlace(userId = ME): Promise<unknown> {
  const found = (await mongo.db.collection('users').findOne({ id: userId }, { projection: { _id: 0, address: 1, location: 1 } })) as unknown;
  return found;
}

// Interface GET /api/users/me
describe('Unmocked: GET /api/users/me', () => {
  // Input: GET with no Authorization header, or with a token that is not a valid JWT (see table)
  // Expected status code: 401
  // Expected behavior: the request is rejected before the database is read
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ auth, error }: TokenCase) => {
    const response = await getMe(auth);

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
  });

  // Input: GET with a valid token for STRANGER, who has never signed in, so has no saved profile
  // Expected status code: 404
  // Expected behavior: nothing is returned or created
  // Expected output: { error: 'Not Found' }
  test('No Saved Profile: 404', async () => {
    const response = await getMe(bearer(STRANGER));

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
    expect(await storedPlace(STRANGER)).toBeNull();
  });

  // Input: GET as ME, who has not set an address
  // Expected status code: 200
  // Expected behavior: the profile is returned without address or location keys, so the app shows "Not set"
  // Expected output: { id, firstName, lastName, email, pictureUrl, createdAt, updatedAt }
  test('No Address: 200', async () => {
    const response = await getMe();

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual(PROFILE);
  });

  // Input: GET as ME, who saved "2329 West Mall, Vancouver" at longitude -123.25, latitude 49.26
  // Expected status code: 200
  // Expected behavior: the profile includes the address and its GeoJSON point
  // Expected output: the profile with address and location { type: 'Point', coordinates: [-123.25, 49.26] }
  test('With Address: 200', async () => {
    await saveHome();

    const response = await getMe();

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ ...PROFILE, ...STORED_HOME });
  });
});

// Interface PATCH /api/users/me
describe('Unmocked: PATCH /api/users/me', () => {
  // Input: a valid address body with no Authorization header, or with a token that is not a valid JWT (see table)
  // Expected status code: 401
  // Expected behavior: the request is rejected and no address is saved
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ auth, error }: TokenCase) => {
    const response = await patchMe(HOME, auth);

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
    expect(await storedPlace()).toStrictEqual({});
  });

  // Input: a valid address body from STRANGER, who has no saved profile
  // Expected status code: 404
  // Expected behavior: no profile is created for STRANGER
  // Expected output: { error: 'Not Found' }
  test('No Saved Profile: 404', async () => {
    const response = await patchMe(HOME, bearer(STRANGER));

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
    expect(await storedPlace(STRANGER)).toBeNull();
  });

  // Input: { address: '  2329 West Mall, Vancouver  ', location: { longitude: -123.25, latitude: 49.26 } }
  // Expected status code: 200
  // Expected behavior: the trimmed address is saved with the location as a GeoJSON point, [longitude, latitude]
  // Expected output: the updated profile with address and location
  test('Set Address: 200', async () => {
    const response = await patchMe({ ...HOME, address: `  ${HOME.address}  ` });

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ ...PROFILE, ...STORED_HOME });
    expect(await storedPlace()).toStrictEqual(STORED_HOME);
  });

  // Input: { address: '6335 Thunderbird Crescent', location: { longitude: -123.24, latitude: 49.25 } } after ME saved another address
  // Expected status code: 200
  // Expected behavior: the new address and location replace the old ones
  // Expected output: the updated profile with the new address and location
  test('Replace Address: 200', async () => {
    await saveHome();
    const newHome = { address: '6335 Thunderbird Crescent', location: { type: 'Point', coordinates: [-123.24, 49.25] } };

    const response = await patchMe({ address: newHome.address, location: { longitude: -123.24, latitude: 49.25 } });

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ ...PROFILE, ...newHome });
    expect(await storedPlace()).toStrictEqual(newHome);
  });

  // Input: { address: null, location: null }, when ME has an address saved and when ME has none (see table)
  // Expected status code: 200
  // Expected behavior: both fields are removed from the stored profile, not stored as null
  // Expected output: the profile without address or location keys
  test.each([
    { label: 'Clear Saved Address', saved: true },
    { label: 'Clear When None Saved', saved: false },
  ])('$label: 200', async ({ saved }: { label: string; saved: boolean }) => {
    if (saved) {
      await saveHome();
    }

    const response = await patchMe({ address: null, location: null });

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual(PROFILE);
    expect(await storedPlace()).toStrictEqual({});
  });

  // Input: an address at the edges of the allowed coordinates: longitude 180, latitude 90, and longitude -180, latitude -90
  // Expected status code: 200
  // Expected behavior: the limits themselves are allowed and saved unchanged
  // Expected output: the updated profile with those coordinates
  test.each([
    { label: 'Largest Coordinates', longitude: 180, latitude: 90 },
    { label: 'Smallest Coordinates', longitude: -180, latitude: -90 },
  ])('$label: 200', async ({ longitude, latitude }: { label: string; longitude: number; latitude: number }) => {
    const response = await patchMe({ address: HOME.address, location: { longitude, latitude } });

    expect(response.status).toBe(200);
    expect(await storedPlace()).toStrictEqual({
      address: HOME.address,
      location: { type: 'Point', coordinates: [longitude, latitude] },
    });
  });

  // Input: a body that is not a valid address change, after ME saved "2329 West Mall, Vancouver" (see table)
  // Expected status code: 400
  // Expected behavior: the request is rejected and the saved address is unchanged
  // Expected output: { error: 'Invalid request', details } naming every problem
  test.each<InvalidCase>([
    { label: 'Array Body', body: [HOME], details: ['request body must be a JSON object'] },
    { label: 'Empty Body', body: {}, details: ['address is required', 'location must be { longitude, latitude }'] },
    { label: 'Unsupported Field', body: { ...HOME, firstName: 'Sam' }, details: ['unsupported field "firstName"'] },
    {
      label: 'Only Address Cleared',
      body: { address: null, location: HOME.location },
      details: ['address and location must be set or cleared together'],
    },
    {
      label: 'Only Location Cleared',
      body: { address: HOME.address, location: null },
      details: ['address and location must be set or cleared together'],
    },
    { label: 'Blank Address', body: { ...HOME, address: '   ' }, details: ['address is required'] },
    { label: 'Missing Location', body: { address: HOME.address }, details: ['location must be { longitude, latitude }'] },
    {
      label: 'Coordinates As Text',
      body: { ...HOME, location: { longitude: '-123.25', latitude: '49.26' } },
      details: ['location must be { longitude, latitude }'],
    },
    {
      label: 'Longitude Over 180',
      body: { ...HOME, location: { longitude: 180.0001, latitude: 49.26 } },
      details: ['location is out of range'],
    },
    {
      label: 'Latitude Under -90',
      body: { ...HOME, location: { longitude: -123.25, latitude: -90.0001 } },
      details: ['location is out of range'],
    },
    {
      label: `Address Over ${MAX_ADDRESS_LENGTH} Characters`,
      body: { ...HOME, address: 'a'.repeat(MAX_ADDRESS_LENGTH + 1) },
      details: ['a field is outside its allowed values or length'],
    },
  ])('$label: 400', async ({ body, details }: InvalidCase) => {
    await saveHome();

    const response = await patchMe(body);

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Invalid request', details });
    expect(await storedPlace()).toStrictEqual(STORED_HOME);
  });

  // Input: JSON cut off halfway, and a valid address body padded with spaces to one byte over 4 KB (see table)
  // Expected status code: 400 for the malformed JSON, 413 for the body over the limit
  // Expected behavior: the body is rejected before it is read, and the saved address is unchanged
  // Expected output: { error } naming the problem
  test.each<UnreadableCase>([
    { label: 'Malformed JSON', raw: JSON.stringify(HOME).slice(0, -1), status: 400, expected: { error: 'Malformed request body' } },
    {
      label: 'Body Over 4 KB',
      raw: JSON.stringify(HOME).padEnd(BODY_LIMIT + 1, ' '),
      status: 413,
      expected: { error: 'Request body too large' },
    },
  ])('$label: $status', async ({ raw, status, expected }: UnreadableCase) => {
    await saveHome();

    const response = await patchMeRaw(raw);

    expect(response.status).toBe(status);
    expect(response.body).toStrictEqual(expected);
    expect(await storedPlace()).toStrictEqual(STORED_HOME);
  });
});
