import type { Server } from 'node:http';

import request from 'supertest';

import { MAX_LABEL_LENGTH } from '../../src/models/common';
import { ME, OTHER, bearer } from '../helpers/dealFixtures';
import { clearPostData, countIn } from '../helpers/postFixtures';
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
  await clearPostData(mongo.db);
});

type Body = Record<string, unknown>;

interface TokenCase { label: string; header: string | undefined; error: string }
interface InvalidCase { label: string; body: Body | unknown[]; details: string[] }

const TOKEN_CASES: TokenCase[] = [
  { label: 'No Token', header: undefined, error: 'Missing Authorization: Bearer <session token> header' },
  { label: 'Garbage Token', header: 'Bearer not-a-token', error: 'Invalid or expired session token' },
];

const OPTION_ERROR = `field and a label of 1 to ${MAX_LABEL_LENGTH} characters are required`;
const TOO_LONG = 'a'.repeat(MAX_LABEL_LENGTH + 1);

function withHeader(call: request.Test, header: string | undefined): request.Test {
  return header === undefined ? call : call.set('Authorization', header);
}

function as(call: request.Test, userId = ME): request.Test {
  return call.set('Authorization', bearer(userId));
}

function addOption(body: unknown, userId = ME): request.Test {
  return as(request(app).post('/api/options'), userId).send(body as object);
}

// Interface GET /api/options
describe('Unmocked: GET /api/options', () => {
  // Input: GET /api/options?field=brand with no Authorization header, or with a token that is not a valid JWT (see table)
  // Expected status code: 401
  // Expected behavior: the request is rejected before the database is read
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ header, error }: TokenCase) => {
    const response = await withHeader(request(app).get('/api/options?field=brand'), header);

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
  });

  // Input: GET /api/options?field=Brand, after brands "Muji" and "IKEA" and colour "red" were added
  // Expected status code: 200
  // Expected behavior: the field name is matched in lower case, and only that field's options are returned, by label
  // Expected output: the IKEA option, then the Muji option
  test("One Field's Options, By Label: 200", async () => {
    await addOption({ field: 'brand', label: 'Muji' });
    await addOption({ field: 'brand', label: 'IKEA' }, OTHER);
    await addOption({ field: 'colour', label: 'red' });

    const response = await as(request(app).get('/api/options?field=Brand'));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject([
      { field: 'brand', key: 'ikea', label: 'IKEA', builtin: false, createdBy: OTHER },
      { field: 'brand', key: 'muji', label: 'Muji', builtin: false, createdBy: ME },
    ]);
  });

  // Input: GET /api/options?field=brand when no brands were added
  // Expected status code: 200
  // Expected behavior: nothing is returned
  // Expected output: []
  test('No Options: 200', async () => {
    const response = await as(request(app).get('/api/options?field=brand'));

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual([]);
  });

  // Input: GET /api/options with no field, or with a blank one (see table)
  // Expected status code: 400
  // Expected behavior: the database is not read
  // Expected output: { error: 'Invalid request', details } asking for the field
  test.each(['', '?field=%20'])('Missing Field "%s": 400', async (query: string) => {
    const response = await as(request(app).get(`/api/options${query}`));

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Invalid request', details: ['field query parameter is required'] });
  });
});

// Interface POST /api/options
describe('Unmocked: POST /api/options', () => {
  // Input: POST with no Authorization header, or with a token that is not a valid JWT (see table)
  // Expected status code: 401
  // Expected behavior: the request is rejected and nothing is saved
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ header, error }: TokenCase) => {
    const response = await withHeader(request(app).post('/api/options'), header).send({ field: 'brand', label: 'IKEA' });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
    expect(await countIn(mongo.db, 'options')).toBe(0);
  });

  // Input: { field: 'Brand', label: '  IKEA   Home ' }
  // Expected status code: 201
  // Expected behavior: the option is saved for everyone, with its field and key in lower case and its spaces tidied
  // Expected output: the saved option, created by the caller
  test('New Option: 201', async () => {
    const response = await addOption({ field: 'Brand', label: '  IKEA   Home ' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ field: 'brand', key: 'ikea home', label: 'IKEA Home', builtin: false, createdBy: ME });
    expect(await countIn(mongo.db, 'options')).toBe(1);
  });

  // Input: { field: 'category', label: 'Office Chairs' }
  // Expected status code: 201
  // Expected behavior: a category is saved as posts save it: in lower case and singular
  // Expected output: the option with label 'office chair'
  test('Category Is Saved Singular: 201', async () => {
    const response = await addOption({ field: 'category', label: 'Office Chairs' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ field: 'category', key: 'office chair', label: 'office chair' });
  });

  // Input: { field: 'brand', label: 'ikea' } from OTHER, after ME added "IKEA"
  // Expected status code: 201
  // Expected behavior: the existing option is kept, not duplicated or renamed
  // Expected output: the existing option, labelled "IKEA" and created by ME
  test('Existing Option: 201', async () => {
    await addOption({ field: 'brand', label: 'IKEA' });

    const response = await addOption({ field: 'brand', label: 'ikea' }, OTHER);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ key: 'ikea', label: 'IKEA', createdBy: ME });
    expect(await countIn(mongo.db, 'options')).toBe(1);
  });

  // Input: a body with no field, a blank label, a label over the limit, or a body that is not an object (see table)
  // Expected status code: 400
  // Expected behavior: nothing is saved
  // Expected output: { error: 'Invalid request', details } asking for a field and a label
  test.each<InvalidCase>([
    { label: 'Missing Field', body: { label: 'IKEA' }, details: [OPTION_ERROR] },
    { label: 'Blank Label', body: { field: 'brand', label: '  ' }, details: [OPTION_ERROR] },
    { label: 'Label Too Long', body: { field: 'brand', label: TOO_LONG }, details: [OPTION_ERROR] },
    { label: 'Body Is Not An Object', body: [], details: [OPTION_ERROR] },
  ])('$label: 400', async ({ body, details }: InvalidCase) => {
    const response = await addOption(body);

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Invalid request', details });
    expect(await countIn(mongo.db, 'options')).toBe(0);
  });
});
