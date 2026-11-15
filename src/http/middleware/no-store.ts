import type { RequestHandler } from 'express';

/** CMS responses may contain drafts: browsers and shared caches must never store them. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
