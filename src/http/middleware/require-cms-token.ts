import { createHash, timingSafeEqual } from 'node:crypto';

import type { RequestHandler } from 'express';

import { httpErrors } from '../http-error.js';

const BEARER = /^Bearer\s+(\S+)\s*$/i;

/**
 * Guards the CMS with the static bearer token allowed by the brief (Note 1). This is not an
 * authentication system: there is a single shared token and no user accounts.
 */
export function requireCmsToken(expectedToken: string): RequestHandler {
  const expectedDigest = digest(expectedToken);

  return (req, _res, next) => {
    const presented = BEARER.exec(req.headers.authorization ?? '')?.[1];
    if (presented === undefined) {
      throw httpErrors.missingToken();
    }
    // Comparing fixed-length digests in constant time avoids leaking the token through timing.
    if (!timingSafeEqual(digest(presented), expectedDigest)) {
      throw httpErrors.invalidToken();
    }
    next();
  };
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
