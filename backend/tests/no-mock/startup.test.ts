import { LISTINGS_COLLECTION } from '../../src/components/posts/models/listing';
import { createMongoStore } from '../../src/shared/store/mongoStore';
import { OTHER, makeListing } from '../helpers/dealFixtures';
import { CLIENT_OPTIONS, TEST_MONGODB_URI, createTestStore, type TestStore } from '../helpers/testStore';

let mongo: TestStore;

beforeAll(async () => {
  mongo = await createTestStore();
});

afterAll(async () => {
  await mongo.dropAndClose();
});

// Runs at start-up, so no HTTP interface reaches it.
describe('Unmocked: createMongoStore', () => {
  // Input: createMongoStore again on a database that already has the collections, as when the server restarts
  // Expected behavior: the existing collections keep their data and get their validators again
  // Expected output: the stored listing is still there, and a listing without a name is still rejected
  test('Restart On An Existing Database', async () => {
    const listing = await makeListing(mongo.store, OTHER);

    const restarted = await createMongoStore(TEST_MONGODB_URI, mongo.dbName, CLIENT_OPTIONS);
    await restarted.close();

    expect(await mongo.store.listings.findById(listing.id)).toMatchObject({ id: listing.id });
    await expect(mongo.db.collection(LISTINGS_COLLECTION).insertOne({ ownerId: OTHER })).rejects.toMatchObject({ code: 121 });
  });
});
