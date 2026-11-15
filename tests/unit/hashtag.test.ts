import { describe, expect, it } from 'vitest';

import { HASHTAG_PATTERN, normalizeHashtag, normalizeHashtags } from '../../src/posts/hashtag.js';

/** Whether `raw` is accepted as a hashtag: its canonical form must match the pattern. */
function isValidHashtag(raw: string): boolean {
  return HASHTAG_PATTERN.test(normalizeHashtag(raw));
}

describe('normalizeHashtag', () => {
  it('lower-cases', () => {
    expect(normalizeHashtag('NodeJS')).toBe('nodejs');
    expect(normalizeHashtag('ÇA')).toBe('ça'); // ÇA → ça
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeHashtag(' \t nodejs \n')).toBe('nodejs');
  });

  it('strips a leading #, after trimming', () => {
    expect(normalizeHashtag('#nodejs')).toBe('nodejs');
    expect(normalizeHashtag('  #NodeJS  ')).toBe('nodejs');
  });

  it('strips only one leading #', () => {
    expect(normalizeHashtag('##nodejs')).toBe('#nodejs');
  });

  it('applies Unicode NFC normalization, so equivalent spellings are equal', () => {
    const decomposed = 'cafe\u0301'; // "e" + COMBINING ACUTE ACCENT (U+0301)
    expect(normalizeHashtag(decomposed)).toBe('caf\u00e9'); // precomposed "é" (U+00E9)
    expect(normalizeHashtag(decomposed)).toBe(normalizeHashtag('CAF\u00c9'));
  });
});

describe('HASHTAG_PATTERN, applied to the canonical form', () => {
  it.each([
    ['ASCII letters', 'nodejs'],
    ['digits', '2026'],
    ['underscores', 'node_js'],
    ['accented letters', 'café'],
    ['CJK ideographs', '日本語'],
    ['Greek letters', 'αβγ'],
    ['combining marks', 'हिन्दी'],
    ['a # prefix', '#nodejs'],
  ])('accepts %s (%s)', (_, raw) => {
    expect(isValidHashtag(raw)).toBe(true);
  });

  it.each([
    ['a hyphen', 'node-js'],
    ['a dot', 'node.js'],
    ['inner whitespace', 'node js'],
    ['punctuation', 'c++'],
    ['an emoji', 'launch🚀'],
    ['a # that is not leading', 'c#'],
    ['a second leading #', '##nodejs'],
    ['an empty string', ''],
    ['only whitespace', '   '],
    ['only a #', '#'],
  ])('rejects %s (%j)', (_, raw) => {
    expect(isValidHashtag(raw)).toBe(false);
  });

  it('accepts up to 50 characters', () => {
    expect(isValidHashtag('a'.repeat(50))).toBe(true);
    expect(isValidHashtag('a'.repeat(51))).toBe(false);
  });

  it('does not count the # prefix or surrounding whitespace towards the limit', () => {
    expect(isValidHashtag(`  #${'a'.repeat(50)}  `)).toBe(true);
  });

  it('counts characters (code points), not UTF-16 code units', () => {
    const ideograph = '\u{20000}'; // a CJK ideograph outside the BMP: 2 UTF-16 code units
    expect(isValidHashtag(ideograph.repeat(50))).toBe(true);
    expect(isValidHashtag(ideograph.repeat(51))).toBe(false);
  });
});

describe('normalizeHashtags', () => {
  it('normalizes every hashtag and drops duplicates, keeping first-occurrence order', () => {
    expect(
      normalizeHashtags(['Express', '#NodeJS', 'express', ' nodejs ', 'MongoDB', '#EXPRESS']),
    ).toEqual(['express', 'nodejs', 'mongodb']);
  });

  it('treats canonically equivalent spellings as duplicates', () => {
    expect(normalizeHashtags(['caf\u00e9', 'cafe\u0301', 'CAF\u00c9'])).toEqual(['caf\u00e9']);
  });

  it('returns an empty list for no hashtags', () => {
    expect(normalizeHashtags([])).toEqual([]);
  });
});
