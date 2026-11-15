import express, { Router } from 'express';

import type { AppConfig } from '../config/env.js';
import { methodNotAllowed } from '../http/middleware/method-not-allowed.js';
import { noStore } from '../http/middleware/no-store.js';
import { requireCmsToken } from '../http/middleware/require-cms-token.js';
import { requireJson } from '../http/middleware/require-json.js';
import { createPost, deletePost, getPost, listPosts, publishPost } from './post.controller.js';

/** 256 kB: fits the largest valid post (50,000 four-byte characters) with room for the envelope. */
export const JSON_BODY_LIMIT_BYTES = 256 * 1024;

/** Content management API: every route, reads included, requires the bearer token. */
export function createCmsRouter(config: Pick<AppConfig, 'cmsApiToken'>): Router {
  const router = Router();

  // The token is checked before anything else, so 401 wins over any other client error.
  router.use(noStore, requireCmsToken(config.cmsApiToken));

  router
    .route('/posts')
    .get(listPosts)
    // Creating a post is the only operation that takes a body, so it is the only one parsing JSON;
    // a body sent to any other route is ignored.
    .post(requireJson, express.json({ limit: JSON_BODY_LIMIT_BYTES }), createPost)
    .all(methodNotAllowed(['GET', 'HEAD', 'POST']));
  router
    .route('/posts/:id')
    .get(getPost)
    .delete(deletePost)
    .all(methodNotAllowed(['GET', 'HEAD', 'DELETE']));
  router
    .route('/posts/:id/publish')
    .post(publishPost)
    .all(methodNotAllowed(['POST']));

  return router;
}
