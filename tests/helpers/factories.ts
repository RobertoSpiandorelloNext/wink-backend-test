import request from 'supertest';

import { AUTHOR_NAME, type PostStatus } from '../../src/posts/post.constants.js';
import { PostModel, type PostAttributes } from '../../src/posts/post.model.js';
import { auth, createTestApp } from './app.js';
import { postOf, type PostJson } from './responses.js';

/** Well-formed, but never the id of an existing post. */
export const UNKNOWN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

/** Path ids that are not 24 hexadecimal characters. */
export const MALFORMED_IDS = [
  '123',
  'not-an-object-id',
  'aaaaaaaaaaaa', // 12 characters: a valid ObjectId *byte* length, still not 24 hex digits
  'aaaaaaaaaaaaaaaaaaaaaaa', // 23
  'aaaaaaaaaaaaaaaaaaaaaaaaa', // 25
  'gggggggggggggggggggggggg', // 24, not hexadecimal
];

/** A create-post request body. */
export interface PostInput {
  readonly title?: string;
  readonly body?: string;
  readonly hashtags?: readonly string[];
  readonly status?: PostStatus;
}

const app = createTestApp();

/** Creates a post through `POST /api/v1/cms/posts`, as a CMS client would. */
export async function createPost(input: PostInput = {}): Promise<PostJson> {
  const res = await request(app)
    .post('/api/v1/cms/posts')
    .set(auth())
    .send({ title: 'A post', body: 'Some text.', ...input });
  if (res.status !== 201) {
    throw new Error(`Could not create the post: ${res.status} ${res.text}`);
  }
  return postOf(res);
}

export async function createDraft(input: Omit<PostInput, 'status'> = {}): Promise<PostJson> {
  return createPost({ ...input, status: 'draft' });
}

export async function createPublished(input: Omit<PostInput, 'status'> = {}): Promise<PostJson> {
  return createPost({ ...input, status: 'published' });
}

/** A post stored directly through the model; hashtags must already be in canonical form. */
export interface PostFixture {
  readonly title?: string;
  readonly hashtags?: readonly string[];
  /** Defaults to `published`. */
  readonly status?: PostStatus;
  /** Defaults to now for published posts and to null for drafts. */
  readonly publishedAt?: Date | null;
  /** Defaults to now (Mongoose keeps an explicit value on insert). */
  readonly createdAt?: Date;
}

/**
 * Inserts a post through the model, bypassing the API, for tests that must control its dates
 * (the API always stamps the current time). Returns the post id.
 */
export async function insertPost(fixture: PostFixture = {}): Promise<string> {
  const status = fixture.status ?? 'published';
  const defaultPublishedAt = status === 'published' ? new Date() : null;
  const document: PostAttributes & { createdAt?: Date } = {
    title: fixture.title ?? 'A fixture post',
    body: 'Some text.',
    hashtags: [...(fixture.hashtags ?? [])],
    status,
    author: AUTHOR_NAME,
    publishedAt: fixture.publishedAt === undefined ? defaultPublishedAt : fixture.publishedAt,
    ...(fixture.createdAt && { createdAt: fixture.createdAt }),
  };
  const post = await PostModel.create(document);
  return post._id.toHexString();
}
