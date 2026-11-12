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

const LABEL_ERROR = `label must be 1 to ${MAX_LABEL_LENGTH} characters`;
const TYPE_ERROR = 'type must be one of: text, number, bool';
const TOO_LONG = 'a'.repeat(MAX_LABEL_LENGTH + 1);

function withHeader(call: request.Test, header: string | undefined): request.Test {
  return header === undefined ? call : call.set('Authorization', header);
}

function as(call: request.Test, userId = ME): request.Test {
  return call.set('Authorization', bearer(userId));
}

function addField(body: unknown, userId = ME): request.Test {
  return as(request(app).post('/api/custom-fields'), userId).send(body as object);
}

// Interface GET /api/custom-fields
describe('Unmocked: GET /api/custom-fields', () => {
  // Input: GET with no Authorization header, or with a token that is not a valid JWT (see table)
  // Expected status code: 401
  // Expected behavior: the request is rejected before the database is read
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ header, error }: TokenCase) => {
    const response = await withHeader(request(app).get('/api/custom-fields'), header);

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
  });

  // Input: GET as ME, who saved "Material", while OTHER saved "Warranty"
  // Expected status code: 200
  // Expected behavior: only the caller's own custom fields are returned
  // Expected output: [the Material field]
  test('Own Fields Only: 200', async () => {
    await addField({ label: 'Material', type: 'text' });
    await addField({ label: 'Warranty', type: 'bool' }, OTHER);

    const response = await as(request(app).get('/api/custom-fields'));

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual([{ ownerId: ME, key: 'material', label: 'Material', type: 'text' }]);
  });

  // Input: GET as a user with no custom fields
  // Expected status code: 200
  // Expected behavior: nothing is returned
  // Expected output: []
  test('No Fields: 200', async () => {
    const response = await as(request(app).get('/api/custom-fields'));

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual([]);
  });
});

// Interface POST /api/custom-fields
describe('Unmocked: POST /api/custom-fields', () => {
  // Input: POST with no Authorization header, or with a token that is not a valid JWT (see table)
  // Expected status code: 401
  // Expected behavior: the request is rejected and nothing is saved
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ header, error }: TokenCase) => {
    const response = await withHeader(request(app).post('/api/custom-fields'), header).send({ label: 'Material', type: 'text' });

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
    expect(await countIn(mongo.db, 'customFields')).toBe(0);
  });

  // Input: { label: ' Material ', type: 'text' }
  // Expected status code: 201
  // Expected behavior: the field is saved for the caller, with its label trimmed and its key in lower case
  // Expected output: { ownerId, key: 'material', label: 'Material', type: 'text' }
  test('New Field: 201', async () => {
    const response = await addField({ label: ' Material ', type: 'text' });

    expect(response.status).toBe(201);
    expect(response.body).toStrictEqual({ ownerId: ME, key: 'material', label: 'Material', type: 'text' });
    expect(await mongo.store.customFields.list(ME)).toStrictEqual([response.body]);
  });

  // Input: { label: 'MATERIAL', type: 'number' } after the caller saved "Material" as text
  // Expected status code: 409
  // Expected behavior: a field with the same name, in any case, is not added again, and the saved one is kept as it was
  // Expected output: { error } naming the field the caller already has
  test('Field Already Exists: 409', async () => {
    await addField({ label: 'Material', type: 'text' });

    const response = await addField({ label: 'MATERIAL', type: 'number' });

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual({ error: 'You already have a custom field called "Material"' });
    expect(await mongo.store.customFields.list(ME)).toStrictEqual([
      { ownerId: ME, key: 'material', label: 'Material', type: 'text' },
    ]);
  });

  // Input: { label: 'Material', type: 'text' } from ME, when only OTHER has a "Material" field
  // Expected status code: 201
  // Expected behavior: custom fields belong to each user, so another user's field with the same name does not block it
  // Expected output: ME's new field
  test("Same Name As Another User's Field: 201", async () => {
    await addField({ label: 'Material', type: 'bool' }, OTHER);

    const response = await addField({ label: 'Material', type: 'text' });

    expect(response.status).toBe(201);
    expect(response.body).toStrictEqual({ ownerId: ME, key: 'material', label: 'Material', type: 'text' });
    expect(await countIn(mongo.db, 'customFields')).toBe(2);
  });

  // Input: a body that breaks one or more rules (see table)
  // Expected status code: 400
  // Expected behavior: nothing is saved
  // Expected output: { error: 'Invalid request', details } naming every broken rule
  test.each<InvalidCase>([
    { label: 'Blank Label', body: { label: ' ', type: 'text' }, details: [LABEL_ERROR] },
    { label: 'Label Too Long', body: { label: TOO_LONG, type: 'text' }, details: [LABEL_ERROR] },
    {
      label: 'Built-in Label',
      body: { label: 'Brand', type: 'text' },
      details: ['"Brand" is already a built-in field, so there is no need to add it'],
    },
    { label: 'Unknown Type', body: { label: 'Material', type: 'date' }, details: [TYPE_ERROR] },
    { label: 'Body Is Not An Object', body: [], details: [LABEL_ERROR, TYPE_ERROR] },
  ])('$label: 400', async ({ body, details }: InvalidCase) => {
    const response = await addField(body);

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: 'Invalid request', details });
    expect(await countIn(mongo.db, 'customFields')).toBe(0);
  });
});

// Interface DELETE /api/custom-fields/:key
describe('Unmocked: DELETE /api/custom-fields/:key', () => {
  function remove(key: string, userId = ME): request.Test {
    return as(request(app).delete(`/api/custom-fields/${key}`), userId);
  }

  // Input: DELETE with no Authorization header, or with a token that is not a valid JWT (see table)
  // Expected status code: 401
  // Expected behavior: the request is rejected and the field is kept
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ header, error }: TokenCase) => {
    await addField({ label: 'Material', type: 'text' });

    const response = await withHeader(request(app).delete('/api/custom-fields/material'), header);

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
    expect(await countIn(mongo.db, 'customFields')).toBe(1);
  });

  // Input: DELETE /api/custom-fields/Pickup%20Time for the caller's "Pickup time" field, then the same DELETE again
  // Expected status code: 204, then 404
  // Expected behavior: the key is matched in lower case and the field is removed; the second delete finds nothing
  // Expected output: an empty body, then { error: 'Not Found' }
  test('Own Field: 204, Then 404', async () => {
    await addField({ label: 'Pickup time', type: 'text' });

    const response = await remove('Pickup%20Time');
    const again = await remove('Pickup%20Time');

    expect(response.status).toBe(204);
    expect(response.body).toStrictEqual({});
    expect(await countIn(mongo.db, 'customFields')).toBe(0);
    expect(again.status).toBe(404);
    expect(again.body).toStrictEqual({ error: 'Not Found' });
  });

  // Input: DELETE /api/custom-fields/warranty as ME, when only OTHER has a "Warranty" field
  // Expected status code: 404
  // Expected behavior: another user's field is not removed
  // Expected output: { error: 'Not Found' }
  test("Another User's Field: 404", async () => {
    await addField({ label: 'Warranty', type: 'bool' }, OTHER);

    const response = await remove('warranty');

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Not Found' });
    expect(await mongo.store.customFields.list(OTHER)).toHaveLength(1);
  });
});
