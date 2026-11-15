import type { PostStatus } from './post.constants.js';
import type { PostRecord } from './post.model.js';

/** The public JSON representation of a post, identical for the blog and the CMS. */
export interface PostResponse {
  id: string;
  title: string;
  body: string;
  hashtags: string[];
  status: PostStatus;
  author: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The only place that knows the API shape of a post: persistence details (`_id`) never leak, and
 * every key is always present so clients can rely on it.
 */
export function toPostResponse(post: PostRecord): PostResponse {
  return {
    id: post._id.toHexString(),
    title: post.title,
    body: post.body,
    hashtags: [...post.hashtags],
    status: post.status,
    author: post.author,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}
