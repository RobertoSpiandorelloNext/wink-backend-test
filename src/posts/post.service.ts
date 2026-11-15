import type { QueryFilter, SortOrder } from 'mongoose';

import { AUTHOR_NAME, type HashtagMatch } from './post.constants.js';
import { PostModel, type PostAttributes, type PostRecord } from './post.model.js';
import type { BlogListQuery, CmsListQuery, CreatePostInput } from './post.schemas.js';

// Business rules and persistence for posts. Framework-agnostic: no Express types in here.
// "Not found" is a normal outcome (null / false), translated to HTTP by the controller.

export interface PostList {
  readonly items: PostRecord[];
  readonly total: number;
}

/** The blog feed: published posts only, most recently published first. */
export async function listPublishedPosts(query: BlogListQuery): Promise<PostList> {
  return findPage(
    { status: 'published', ...hashtagCondition(query.hashtags, query.match) },
    { publishedAt: -1, _id: -1 },
    query,
  );
}

/** The CMS dashboard: posts in any status, most recently created first. */
export async function listPosts(query: CmsListQuery): Promise<PostList> {
  return findPage(
    {
      ...(query.status !== undefined && { status: query.status }),
      ...hashtagCondition(query.hashtags, query.match),
    },
    { createdAt: -1, _id: -1 },
    query,
  );
}

/** A post as readers may see it: drafts are treated exactly like missing posts. */
export async function getPublishedPost(id: string): Promise<PostRecord | null> {
  return PostModel.findOne({ _id: id, status: 'published' }).lean<PostRecord>();
}

export async function getPost(id: string): Promise<PostRecord | null> {
  return PostModel.findById(id).lean<PostRecord>();
}

/** Creates a post. The author is always Brian Fox and is never taken from the client. */
export async function createPost(input: CreatePostInput): Promise<PostRecord> {
  const post = await PostModel.create({
    ...input,
    author: AUTHOR_NAME,
    publishedAt: input.status === 'published' ? new Date() : null,
  });
  return post.toObject<PostRecord>();
}

/**
 * Publishes a draft. Idempotent: publishing an already published post returns it unchanged, with
 * its original publication date. The conditional update makes the draft -> published transition
 * atomic, so concurrent calls cannot set two different dates.
 */
export async function publishPost(id: string): Promise<PostRecord | null> {
  const published = await PostModel.findOneAndUpdate(
    { _id: id, status: 'draft' },
    { $set: { status: 'published', publishedAt: new Date() } },
    { returnDocument: 'after' },
  ).lean<PostRecord>();

  // No draft matched: the post is either already published, or does not exist.
  return published ?? getPost(id);
}

/** Permanently deletes a post in any status. Returns false if it did not exist. */
export async function deletePost(id: string): Promise<boolean> {
  const { deletedCount } = await PostModel.deleteOne({ _id: id });
  return deletedCount === 1;
}

function hashtagCondition(hashtags: string[], match: HashtagMatch): QueryFilter<PostAttributes> {
  // An empty $in / $all matches nothing, so no filter means no condition at all.
  if (hashtags.length === 0) {
    return {};
  }
  return { hashtags: match === 'all' ? { $all: hashtags } : { $in: hashtags } };
}

async function findPage(
  filter: QueryFilter<PostAttributes>,
  sort: Record<string, SortOrder>,
  { page, limit }: { page: number; limit: number },
): Promise<PostList> {
  const [items, total] = await Promise.all([
    PostModel.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<PostRecord[]>(),
    PostModel.countDocuments(filter),
  ]);
  return { items, total };
}
