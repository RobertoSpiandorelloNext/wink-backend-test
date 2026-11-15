import type { Request, RequestHandler } from 'express';

import { httpErrors } from '../http-error.js';

/**
 * Rejects bodies sent with another media type. Without this, Express leaves `req.body` undefined
 * and the client would get a confusing "title is required" instead of a clear 415.
 */
export const requireJson: RequestHandler = (req, _res, next) => {
  if (hasContent(req) && !req.is('application/json')) {
    throw httpErrors.unsupportedMediaType();
  }
  next();
};

/**
 * Whether the request actually carries bytes. `req.is()` treats `Content-Length: 0` (what
 * `fetch()` sends for a POST without a body) as a body; here an empty request is validated as
 * an empty object instead, so the client learns which fields are required.
 */
function hasContent(req: Request): boolean {
  return (
    req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length']) > 0
  );
}
