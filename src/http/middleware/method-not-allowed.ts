import type { RequestHandler } from 'express';

import { httpErrors } from '../http-error.js';

/**
 * Terminates a `router.route()` chain: a known path called with an unsupported method gets a
 * 405 with an `Allow` header instead of a misleading 404.
 */
export function methodNotAllowed(allowed: readonly string[]): RequestHandler {
  return (req) => {
    throw httpErrors.methodNotAllowed(req.method, allowed);
  };
}
