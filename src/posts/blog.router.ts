import { Router } from 'express';

import { methodNotAllowed } from '../http/middleware/method-not-allowed.js';
import { getPublishedPost, listPublishedPosts } from './post.controller.js';

const READ_ONLY = ['GET', 'HEAD'];

/** Public, read-only API for the blog: only published posts are ever visible here. */
export function createBlogRouter(): Router {
  const router = Router();

  router.route('/posts').get(listPublishedPosts).all(methodNotAllowed(READ_ONLY));
  router.route('/posts/:id').get(getPublishedPost).all(methodNotAllowed(READ_ONLY));

  return router;
}
