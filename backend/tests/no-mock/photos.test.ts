import type { Server } from 'node:http';

import request from 'supertest';

import { MAX_PHOTOS, MAX_PHOTO_BYTES } from '../../src/models/common';
import { ME, bearer } from '../helpers/dealFixtures';
import { countIn } from '../helpers/postFixtures';
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
  await Promise.all([
    mongo.db.collection('photos.files').deleteMany({}),
    mongo.db.collection('photos.chunks').deleteMany({}),
  ]);
});

interface TokenCase { label: string; header: string | undefined; error: string }
interface Attachment { field: string; bytes: Buffer; contentType: string }
interface RejectCase { label: string; files: Attachment[]; status: number; error: string }
interface IdCase { label: string; id: string }
interface StoredPhoto { metadata: { mimeType: string; ownerId: string } }

// The route checks the type and size, not the image itself, so any bytes will do.
const JPEG = Buffer.from('jpeg bytes');
const BAD_PHOTOS = 'Attach images (jpeg, png, webp or gif) in the "photos" field';

const TOKEN_CASES: TokenCase[] = [
  { label: 'No Token', header: undefined, error: 'Missing Authorization: Bearer <session token> header' },
  { label: 'Garbage Token', header: 'Bearer not-a-token', error: 'Invalid or expired session token' },
];

function photo(bytes = JPEG, contentType = 'image/jpeg'): Attachment {
  return { field: 'photos', bytes, contentType };
}

// `header` is the Authorization header to send, or undefined to send none.
function uploadWith(header: string | undefined, files: Attachment[]): request.Test {
  let call = request(app).post('/api/photos');
  if (header !== undefined) {
    call = call.set('Authorization', header);
  }
  files.forEach(({ field, bytes, contentType }, index) => {
    call = call.attach(field, bytes, { filename: `photo${index}`, contentType });
  });
  return call;
}

function upload(files: Attachment[]): request.Test {
  return uploadWith(bearer(ME), files);
}

function storedPhotos(): Promise<number> {
  return countIn(mongo.db, 'photos.files');
}

async function stored(): Promise<StoredPhoto[]> {
  const found: unknown = await mongo.db.collection('photos.files').find().toArray();
  return found as StoredPhoto[];
}

// Interface POST /api/photos
describe('Unmocked: POST /api/photos', () => {
  // Input: an upload with no Authorization header, or with a token that is not a valid JWT (see table)
  // Expected status code: 401
  // Expected behavior: the request is rejected and nothing is saved
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ header, error }: TokenCase) => {
    const response = await uploadWith(header, [photo()]);

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
    expect(await storedPhotos()).toBe(0);
  });

  // Input: one JPEG in the "photos" field
  // Expected status code: 201
  // Expected behavior: the photo is saved with its type and the caller as owner
  // Expected output: { ids } with one photo id
  test('One Photo: 201', async () => {
    const response = await upload([photo()]);

    expect(response.status).toBe(201);
    const { ids } = response.body as { ids: string[] };
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^[0-9a-f]{24}$/);
    expect(await stored()).toMatchObject([{ metadata: { mimeType: 'image/jpeg', ownerId: ME } }]);
  });

  // Input: the most photos allowed, each of an accepted type, one with an upper-case type "image/PNG"
  // Expected status code: 201
  // Expected behavior: every photo is saved, with its type in lower case
  // Expected output: { ids } with one distinct id per photo
  test('Most Photos Allowed: 201', async () => {
    const types = ['image/jpeg', 'image/PNG', 'image/webp', 'image/gif'];
    const files = Array.from({ length: MAX_PHOTOS }, (_, index) => photo(JPEG, types[index % types.length]));

    const response = await upload(files);

    expect(response.status).toBe(201);
    const { ids } = response.body as { ids: string[] };
    expect(new Set(ids).size).toBe(MAX_PHOTOS);
    const savedTypes = (await stored()).map((file) => file.metadata.mimeType);
    expect(savedTypes).toContain('image/png');
    expect(savedTypes).not.toContain('image/PNG');
  });

  // Input: an upload that breaks one rule (see table)
  // Expected status code: 400, or 413 for a photo over the size limit
  // Expected behavior: nothing is saved
  // Expected output: { error } naming the problem
  test.each<RejectCase>([
    { label: 'No Photos', files: [], status: 400, error: BAD_PHOTOS },
    { label: 'Not An Image', files: [photo(JPEG, 'text/plain')], status: 400, error: BAD_PHOTOS },
    { label: 'Empty Photo', files: [photo(Buffer.alloc(0))], status: 400, error: BAD_PHOTOS },
    { label: 'Wrong Field', files: [{ field: 'picture', bytes: JPEG, contentType: 'image/jpeg' }], status: 400, error: BAD_PHOTOS },
    {
      label: 'Too Many Photos',
      files: Array.from({ length: MAX_PHOTOS + 1 }, () => photo()),
      status: 400,
      error: `At most ${MAX_PHOTOS} photos are allowed`,
    },
    {
      label: 'Photo Too Big',
      files: [photo(Buffer.alloc(MAX_PHOTO_BYTES + 1, 1))],
      status: 413,
      error: `Each photo must be at most ${MAX_PHOTO_BYTES / (1024 * 1024)} MB`,
    },
  ])('$label: $status', async ({ files, status, error }: RejectCase) => {
    const response = await upload(files);

    expect(response.status).toBe(status);
    expect(response.body).toStrictEqual({ error });
    expect(await storedPhotos()).toBe(0);
  });

  // Input: a multipart body that is cut off before its closing boundary
  // Expected status code: 400
  // Expected behavior: nothing is saved
  // Expected output: { error } asking for images in the "photos" field
  test('Malformed Multipart Body: 400', async () => {
    const response = await request(app)
      .post('/api/photos')
      .set('Authorization', bearer(ME))
      .set('Content-Type', 'multipart/form-data; boundary=xyz')
      .send('--xyz\r\nContent-Disposition: form-data; name="photos"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\njpeg');

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({ error: BAD_PHOTOS });
    expect(await storedPhotos()).toBe(0);
  });
});

// Interface GET /api/photos/:id
describe('Unmocked: GET /api/photos/:id', () => {
  // Input: GET /api/photos/:id of an uploaded photo with no Authorization header, or with a token that is not a valid JWT (see table)
  // Expected status code: 401
  // Expected behavior: the photo is only sent to signed-in users, so nothing is streamed
  // Expected output: { error } naming the auth problem
  test.each(TOKEN_CASES)('$label: 401', async ({ header, error }: TokenCase) => {
    const uploaded = await upload([photo()]);
    const [id] = (uploaded.body as { ids: string[] }).ids;
    const call = request(app).get(`/api/photos/${String(id)}`);

    const response = await (header === undefined ? call : call.set('Authorization', header));

    expect(response.status).toBe(401);
    expect(response.body).toStrictEqual({ error });
  });

  // Input: GET /api/photos/:id of an uploaded PNG, as a signed-in user
  // Expected status code: 200
  // Expected behavior: the photo is sent, and only the user's own device may cache it
  // Expected output: the uploaded bytes, with Content-Type image/png
  test('Uploaded Photo: 200', async () => {
    const bytes = Buffer.from('png bytes');
    const uploaded = await upload([photo(bytes, 'image/png')]);
    const [id] = (uploaded.body as { ids: string[] }).ids;

    const response = await request(app).get(`/api/photos/${id}`).set('Authorization', bearer(ME)).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        done(null, Buffer.concat(chunks));
      });
    });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(response.body).toStrictEqual(bytes);
  });

  // Input: GET /api/photos/:id with a well-formed id that matches no photo, or with a malformed id (see table)
  // Expected status code: 404
  // Expected behavior: nothing is streamed
  // Expected output: { error: 'Photo not found' }
  test.each<IdCase>([
    { label: 'Unknown Id', id: '6ad40b88e74dd3678bfef8ff' },
    { label: 'Malformed Id', id: 'not-an-id' },
  ])('$label: 404', async ({ id }: IdCase) => {
    const response = await request(app).get(`/api/photos/${id}`).set('Authorization', bearer(ME));

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual({ error: 'Photo not found' });
  });
});
