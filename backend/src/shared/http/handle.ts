import type { Request, RequestHandler, Response } from 'express';

export function handle(run: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    run(req, res).catch((error: unknown) => {
      next(error);
    });
  };
}
