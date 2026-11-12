import type { Server } from 'node:http';
import { Readable } from 'node:stream';

import request from 'supertest';

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
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const FAILURE = new Error('MongoDB is unreachable');
const SERVER_ERROR = { error: 'Internal Server Error' };
const PHOTO_ID = '6ad40b88e74dd3678bfef8f3';

// Interface POST /api/photos
describe('Mocked: POST /api/photos', () => {
  // Mocked behavior: photos.save rejects with Error('MongoDB is unreachable')
  // Input: two JPEGs in the "photos" field
  // Expected status code: 500
  // Expected behavior: the error is handled, save is called for each photo, and nothing is stored
  // Expected output: { error: 'Internal Server Error' }
  test('photos.save Throws: 500', async () => {
    const spy = jest.spyOn(mongo.store.photos, 'save').mockRejectedValue(FAILURE);

    const response = await request(app)
      .post('/api/photos')
      .set('Authorization', bearer(ME))
      .attach('photos', Buffer.from('a'), { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('photos', Buffer.from('b'), { filename: 'b.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual(SERVER_ERROR);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await countIn(mongo.db, 'photos.files')).toBe(0);
  });
});

// Interface GET /api/photos/:id
describe('Mocked: GET /api/photos/:id', () => {
  // Mocked behavior: photos.open rejects with Error('MongoDB is unreachable')
  // Input: GET /api/photos/:id with a well-formed id
  // Expected status code: 500
  // Expected behavior: the error is handled and open is called once
  // Expected output: { error: 'Internal Server Error' }
  test('photos.open Throws: 500', async () => {
    const spy = jest.spyOn(mongo.store.photos, 'open').mockRejectedValue(FAILURE);

    const response = await request(app).get(`/api/photos/${PHOTO_ID}`).set('Authorization', bearer(ME));

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual(SERVER_ERROR);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // Mocked behavior: photos.open finds the photo, but its download stream fails before sending any bytes
  // Input: GET /api/photos/:id with a well-formed id
  // Expected status code: none: the server closes the connection
  // Expected behavior: the failed stream also ends the response, so the client sees a failed download, not a broken image
  // Expected output: none
  test('Photo Stream Fails: Connection Closed', async () => {
    const stream = new Readable({
      read() {
        this.destroy(FAILURE);
      },
    });
    const spy = jest.spyOn(mongo.store.photos, 'open').mockResolvedValue({ mimeType: 'image/jpeg', stream });

    await expect(request(app).get(`/api/photos/${PHOTO_ID}`).set('Authorization', bearer(ME))).rejects.toThrow('socket hang up');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
