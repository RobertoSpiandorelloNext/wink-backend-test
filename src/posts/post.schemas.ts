import { z } from 'zod';

import { paginationQuery } from '../http/pagination.js';
import { HASHTAG_PATTERN, normalizeHashtag } from './hashtag.js';
import {
  BODY_MAX_LENGTH,
  DEFAULT_HASHTAG_MATCH,
  DEFAULT_POST_STATUS,
  HASHTAG_MATCH_MODES,
  HASHTAG_MAX_LENGTH,
  HASHTAGS_MAX_ITEMS,
  POST_STATUSES,
  TITLE_MAX_LENGTH,
} from './post.constants.js';

// Request schemas are strict: an unknown field (a typo, or a read-only field such as `author`)
// is reported to the client instead of being silently ignored.

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export const postIdParams = z.strictObject({
  id: z.string().regex(OBJECT_ID_PATTERN, {
    error: 'id must be a 24-character hexadecimal ObjectId',
  }),
});

const HASHTAG_RULE = `must be 1-${HASHTAG_MAX_LENGTH} letters, digits or underscores, optionally prefixed with #`;

/** One hashtag, validated in its canonical form. */
const hashtag = z
  .string()
  .transform(normalizeHashtag)
  .pipe(z.string().regex(HASHTAG_PATTERN, { error: `hashtag ${HASHTAG_RULE}` }));

const unique = (values: string[]): string[] => [...new Set(values)];

export const createPostBody = z.strictObject({
  title: z
    .string()
    .trim()
    .min(1, { error: 'title must not be empty' })
    .max(TITLE_MAX_LENGTH, { error: `title must be at most ${TITLE_MAX_LENGTH} characters` }),
  // Stored verbatim (leading whitespace can be meaningful in Markdown), but never blank.
  body: z
    .string()
    .max(BODY_MAX_LENGTH, { error: `body must be at most ${BODY_MAX_LENGTH} characters` })
    .refine((value) => value.trim().length > 0, { error: 'body must not be empty' }),
  hashtags: z
    .array(hashtag)
    .max(HASHTAGS_MAX_ITEMS, { error: `a post can have at most ${HASHTAGS_MAX_ITEMS} hashtags` })
    .transform(unique)
    .default([]),
  status: z.enum(POST_STATUSES).default(DEFAULT_POST_STATUS),
});

/**
 * The `hashtags` filter: `?hashtags=a,b`, `?hashtags=a&hashtags=b` or both, normalized exactly like
 * stored hashtags. Problems are reported on the `hashtags` parameter as a whole.
 */
const hashtagFilter = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    unique(
      [value]
        .flat()
        .flatMap((segment) => segment.split(','))
        .filter((segment) => segment.trim().length > 0)
        .map(normalizeHashtag),
    ),
  )
  .superRefine((tags, ctx) => {
    const invalid = tags.find((tag) => !HASHTAG_PATTERN.test(tag));
    if (invalid !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `"${invalid}" is not a valid hashtag: ${HASHTAG_RULE}`,
      });
    }
    if (tags.length > HASHTAGS_MAX_ITEMS) {
      ctx.addIssue({
        code: 'too_big',
        origin: 'array',
        maximum: HASHTAGS_MAX_ITEMS,
        inclusive: true,
        message: `filter by at most ${HASHTAGS_MAX_ITEMS} hashtags`,
      });
    }
  })
  .default([]);

const listQueryShape = {
  hashtags: hashtagFilter,
  match: z.enum(HASHTAG_MATCH_MODES).default(DEFAULT_HASHTAG_MATCH),
  ...paginationQuery,
};

export const blogListQuery = z.strictObject(listQueryShape);

export const cmsListQuery = z.strictObject({
  ...listQueryShape,
  status: z.enum(POST_STATUSES).optional(),
});

export type PostIdParams = z.output<typeof postIdParams>;
export type CreatePostInput = z.output<typeof createPostBody>;
export type BlogListQuery = z.output<typeof blogListQuery>;
export type CmsListQuery = z.output<typeof cmsListQuery>;
