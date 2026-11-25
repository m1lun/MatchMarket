import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { GridFSBucket, ObjectId, type Db } from 'mongodb';

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface PhotoStorage {
  save(data: Buffer, mimeType: string, ownerId: string): Promise<string>;
  open(id: string): Promise<{ mimeType: string; stream: Readable } | null>;
}

export function createGridFsPhotoStorage(db: Db): PhotoStorage {
  const bucket = new GridFSBucket(db, { bucketName: 'photos' });
  return {
    async save(data, mimeType, ownerId) {
      const upload = bucket.openUploadStream('photo', { metadata: { mimeType, ownerId } });
      await pipeline(Readable.from(data), upload);
      return String(upload.id);
    },

    async open(id) {
      if (!ObjectId.isValid(id)) {
        return null;
      }
      const _id = new ObjectId(id);
      const file = await bucket.find({ _id }).limit(1).next();
      if (file === null) {
        return null;
      }
      return { mimeType: String(file.metadata?.mimeType), stream: bucket.openDownloadStream(_id) };
    },
  };
}
