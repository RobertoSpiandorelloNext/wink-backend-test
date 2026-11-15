/** The brief: the author name "is always Brian Fox". Set by the server, never by clients. */
export const AUTHOR_NAME = 'Brian Fox';

export const POST_STATUSES = ['draft', 'published'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** The brief: "default status is draft". */
export const DEFAULT_POST_STATUS: PostStatus = 'draft';

/** How a hashtag filter combines its values: posts with any of them, or with all of them. */
export const HASHTAG_MATCH_MODES = ['any', 'all'] as const;
export type HashtagMatch = (typeof HASHTAG_MATCH_MODES)[number];

export const DEFAULT_HASHTAG_MATCH: HashtagMatch = 'any';

// Limits are counted in Unicode code points and enforced by the request schemas only.
export const TITLE_MAX_LENGTH = 200;
export const BODY_MAX_LENGTH = 50_000;
export const HASHTAG_MAX_LENGTH = 50;
/** Maximum hashtags on a post, and in a hashtag filter. */
export const HASHTAGS_MAX_ITEMS = 10;
