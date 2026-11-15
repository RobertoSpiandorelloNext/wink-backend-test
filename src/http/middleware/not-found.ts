import type { RequestHandler } from 'express';

import { httpErrors } from '../http-error.js';

/** Fallback for any path no router handled: a JSON 404 rather than Express's HTML page. */
export const notFound: RequestHandler = (req) => {
  throw httpErrors.routeNotFound(req.method, req.path);
};
