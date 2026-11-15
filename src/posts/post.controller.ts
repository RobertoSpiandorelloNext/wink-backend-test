import type { RequestHandler } from 'express';

import { httpErrors } from '../http/http-error.js';
import { toPagination } from '../http/pagination.js';
import { parseInput } from '../http/validation.js';
import { toPostResponse } from './post.presenter.js';
import { blogListQuery, cmsListQuery, createPostBody, postIdParams } from './post.schemas.js';
import * as postService from './post.service.js';

// HTTP adapters: validate the request, call the service, shape the response.

// ---- Blog (public) ----

export const listPublishedPosts: RequestHandler = async (req, res) => {
  const query = parseInput(blogListQuery, req.query, 'query');
  const { items, total } = await postService.listPublishedPosts(query);
  res.json({
    data: items.map(toPostResponse),
    pagination: toPagination(query.page, query.limit, total),
  });
};

export const getPublishedPost: RequestHandler = async (req, res) => {
  const { id } = parseInput(postIdParams, req.params, 'params');
  const post = await postService.getPublishedPost(id);
  if (post === null) {
    throw httpErrors.postNotFound();
  }
  res.json({ data: toPostResponse(post) });
};

// ---- CMS (bearer token) ----

export const listPosts: RequestHandler = async (req, res) => {
  const query = parseInput(cmsListQuery, req.query, 'query');
  const { items, total } = await postService.listPosts(query);
  res.json({
    data: items.map(toPostResponse),
    pagination: toPagination(query.page, query.limit, total),
  });
};

export const getPost: RequestHandler = async (req, res) => {
  const { id } = parseInput(postIdParams, req.params, 'params');
  const post = await postService.getPost(id);
  if (post === null) {
    throw httpErrors.postNotFound();
  }
  res.json({ data: toPostResponse(post) });
};

export const createPost: RequestHandler = async (req, res) => {
  // Express 5 leaves req.body undefined when no body was sent: validate it as an empty object.
  const input = parseInput(createPostBody, req.body ?? {}, 'body');
  const post = toPostResponse(await postService.createPost(input));
  res.status(201).location(`${req.baseUrl}/posts/${post.id}`).json({ data: post });
};

export const publishPost: RequestHandler = async (req, res) => {
  const { id } = parseInput(postIdParams, req.params, 'params');
  const post = await postService.publishPost(id);
  if (post === null) {
    throw httpErrors.postNotFound();
  }
  res.json({ data: toPostResponse(post) });
};

export const deletePost: RequestHandler = async (req, res) => {
  const { id } = parseInput(postIdParams, req.params, 'params');
  if (!(await postService.deletePost(id))) {
    throw httpErrors.postNotFound();
  }
  res.status(204).end();
};
