import { model, Schema, type Types } from 'mongoose';

import { POST_STATUSES, type PostStatus } from './post.constants.js';

/** Fields stored for a post, as written by the service. */
export interface PostAttributes {
  title: string;
  body: string;
  /** Canonical hashtags (see hashtag.ts), without `#`. */
  hashtags: string[];
  status: PostStatus;
  author: string;
  /** Set once, when the post becomes published; null while it is a draft. */
  publishedAt: Date | null;
}

/** A post as read from MongoDB with `.lean()`. */
export interface PostRecord extends PostAttributes {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// Length limits are deliberately not repeated here: the request schemas count Unicode code points,
// Mongoose's maxlength counts UTF-16 units, and a mismatch would surface as a 500.
const postSchema = new Schema<PostAttributes>(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
    hashtags: { type: [String], default: [] },
    status: { type: String, enum: POST_STATUSES, required: true },
    author: { type: String, required: true, immutable: true },
    publishedAt: { type: Date, default: null },
  },
  { collection: 'posts', timestamps: true, versionKey: false },
);

// Each index backs one query shape (equality fields first, then the sort keys, with _id as the
// tie-breaker that keeps pagination stable).

// Blog feed and its count: { status: 'published' } sorted by publishedAt desc.
postSchema.index({ status: 1, publishedAt: -1, _id: -1 }, { name: 'blog_feed' });
// Hashtag-filtered blog feed ($in / $all on the multikey hashtags field). The CMS hashtag filter
// can use it to find matches too, then sorts them by createdAt.
postSchema.index(
  { hashtags: 1, status: 1, publishedAt: -1, _id: -1 },
  { name: 'blog_feed_by_hashtag' },
);
// CMS dashboard: every post, newest created first.
postSchema.index({ createdAt: -1, _id: -1 }, { name: 'cms_list' });

export const PostModel = model<PostAttributes>('Post', postSchema);
