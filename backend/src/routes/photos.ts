import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { pipeline } from 'node:stream/promises';

import { MAX_PHOTOS, MAX_PHOTO_BYTES } from '../models/common';
import { PHOTO_TYPES, type PhotoStorage } from '../photos/storage';
import { currentUser, requireAuth } from '../sessions';
import { handle } from './handle';

const BAD_PHOTOS = 'Attach images (jpeg, png, webp or gif) in the "photos" field';
const TOO_MANY_PHOTOS = `At most ${MAX_PHOTOS} photos are allowed`;
const PHOTO_TOO_BIG = `Each photo must be at most ${MAX_PHOTO_BYTES / (1024 * 1024)} MB`;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS },
}).array('photos', MAX_PHOTOS);

// Multer stops reading at the first broken limit; anything else it rejects is a malformed body.
function uploadError(error: unknown): { status: number; message: string } {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return { status: 413, message: PHOTO_TOO_BIG };
    }
    if (error.code === 'LIMIT_FILE_COUNT' || (error.code === 'LIMIT_UNEXPECTED_FILE' && error.field === 'photos')) {
      return { status: 400, message: TOO_MANY_PHOTOS };
    }
  }
  return { status: 400, message: BAD_PHOTOS };
}

// Typed here instead of through multer's types, which Codacy cannot load.
interface UploadedFile {
  mimetype: string;
  buffer: Buffer;
  size: number;
}

function uploadedFiles(req: Request): UploadedFile[] {
  const { files } = req as { files?: unknown };
  return Array.isArray(files) ? (files as UploadedFile[]) : [];
}

function readPhotos(req: Request, res: Response, next: NextFunction): void {
  upload(req, res, (error: unknown) => {
    if (error === undefined || error === null) {
      next();
      return;
    }
    const { status, message } = uploadError(error);
    res.status(status).json({ error: message });
  });
}

export function createPhotosRouter(photos: PhotoStorage): Router {
  const router = Router();

  router.get(
    '/:id',
    requireAuth,
    handle(async (req: Request, res: Response) => {
      const photo = await photos.open(String(req.params.id));
      if (photo === null) {
        res.status(404).json({ error: 'Photo not found' });
        return;
      }
      res.set({ 'Content-Type': photo.mimeType, 'Cache-Control': 'private, max-age=31536000, immutable' });
      await pipeline(photo.stream, res);
    }),
  );

  // Up to MAX_PHOTOS images in the "photos" field of one multipart/form-data request.
  router.post(
    '/',
    requireAuth,
    readPhotos,
    handle(async (req: Request, res: Response) => {
      const files = uploadedFiles(req);
      if (files.length === 0 || files.some((f) => !PHOTO_TYPES.includes(f.mimetype.toLowerCase()) || f.size === 0)) {
        res.status(400).json({ error: BAD_PHOTOS });
        return;
      }
      const ownerId = currentUser(res).id;
      const ids = await Promise.all(files.map((f) => photos.save(f.buffer, f.mimetype.toLowerCase(), ownerId)));
      res.status(201).json({ ids });
    }),
  );

  return router;
}
