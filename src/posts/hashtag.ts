import { HASHTAG_MAX_LENGTH } from './post.constants.js';

/**
 * A hashtag in canonical form: letters, combining marks, digits and underscores, without `#`.
 * Unicode-aware, so `café` and `日本語` are valid hashtags.
 */
export const HASHTAG_PATTERN = new RegExp(
  String.raw`^[\p{L}\p{M}\p{N}_]{1,${HASHTAG_MAX_LENGTH}}$`,
  'u',
);

/**
 * Canonical form of a hashtag, so that `#NodeJS`, ` nodejs ` and `NODEJS` are the same tag:
 * trimmed, without one leading `#`, NFC-normalized and lower-cased. Posts are stored and filtered
 * in this form. It does not validate: the result is a hashtag only if it matches
 * {@link HASHTAG_PATTERN}.
 */
export function normalizeHashtag(raw: string): string {
  return raw.trim().replace(/^#/, '').normalize('NFC').toLowerCase();
}

/** Normalizes every hashtag and drops duplicates, keeping the first occurrence of each. */
export function normalizeHashtags(raw: Iterable<string>): string[] {
  return [...new Set(Array.from(raw, normalizeHashtag))];
}
