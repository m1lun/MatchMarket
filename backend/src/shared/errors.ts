import type { ErrorRequestHandler } from 'express';

import { DuplicateFieldError } from '../components/posts/models/normalise';

// A request the client can fix; the details are shown to the user.
export class BadRequestError extends Error {
  constructor(public readonly details: string[]) {
    super(details.join('; '));
  }
}

export class ClientError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

export class NotFoundError extends ClientError {
  constructor(message = 'Not Found') {
    super(404, message);
  }
}

export class ForbiddenError extends ClientError {
  constructor(message = 'Forbidden') {
    super(403, message);
  }
}

export class ConflictError extends ClientError {
  constructor(message: string) {
    super(409, message);
  }
}

// The message of a thrown value, for logs.
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// MongoDB's code for a document that fails the collection's $jsonSchema.
const DOCUMENT_VALIDATION_FAILED = 121;

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof BadRequestError) {
    res.status(400).json({ error: 'Invalid request', details: error.details });
    return;
  }
  if (error instanceof ClientError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  if (error instanceof DuplicateFieldError) {
    res.status(400).json({ error: 'Invalid request', details: [error.message] });
    return;
  }
  const { status, code } = error as { status?: number; code?: number };
  if (status === 400) {
    res.status(400).json({ error: 'Malformed request body' });
    return;
  }
  if (status === 413) {
    res.status(413).json({ error: 'Request body too large' });
    return;
  }
  if (code === DOCUMENT_VALIDATION_FAILED) {
    res.status(400).json({ error: 'Invalid request', details: ['a field is outside its allowed values or length'] });
    return;
  }
  console.error('Unhandled error', error);
  res.status(500).json({ error: 'Internal Server Error' });
};
