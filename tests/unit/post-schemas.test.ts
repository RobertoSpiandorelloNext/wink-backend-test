import { describe, expect, it } from 'vitest';

import { HttpError, type InputLocation } from '../../src/http/http-error.js';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
} from '../../src/http/pagination.js';
import { parseInput } from '../../src/http/validation.js';
import { JSON_BODY_LIMIT_BYTES } from '../../src/posts/cms.router.js';
import {
  AUTHOR_NAME,
  BODY_MAX_LENGTH,
  HASHTAG_MAX_LENGTH,
  HASHTAGS_MAX_ITEMS,
  POST_STATUSES,
  TITLE_MAX_LENGTH,
} from '../../src/posts/post.constants.js';
import {
  blogListQuery,
  cmsListQuery,
  createPostBody,
  postIdParams,
} from '../../src/posts/post.schemas.js';
import type { Issue } from '../helpers/responses.js';

// The schemas are exercised through parseInput, which turns validation problems into the
// documented error details; messages are not part of the contract and are never asserted.

const parseBody = (value: unknown) => parseInput(createPostBody, value, 'body');
const parseBlogQuery = (value: unknown) => parseInput(blogListQuery, value, 'query');
const parseCmsQuery = (value: unknown) => parseInput(cmsListQuery, value, 'query');
const parseParams = (value: unknown) => parseInput(postIdParams, value, 'params');

/** Runs `parse` expecting a 400 VALIDATION_ERROR, and returns its details without messages. */
function issuesOf(parse: () => unknown): Issue[] {
  try {
    parse();
  } catch (error) {
    if (error instanceof HttpError && error.code === 'VALIDATION_ERROR') {
      expect(error.status).toBe(400);
      return (error.details ?? []).map(({ location, field, code }) => ({ location, field, code }));
    }
    throw error;
  }
  throw new Error('Expected a validation error');
}

const issue = (location: InputLocation, field: string | null, code: string): Issue => ({
  location,
  field,
  code,
});

/** 11 distinct, valid hashtags. */
const ELEVEN_HASHTAGS = Array.from({ length: 11 }, (_, index) => `tag${index}`);

/** U+1F600, outside the BMP: one character, two UTF-16 code units. */
const EMOJI = '😀';

describe('limits and defaults', () => {
  it('match the documented limits and defaults', () => {
    expect({ TITLE_MAX_LENGTH, BODY_MAX_LENGTH, HASHTAG_MAX_LENGTH, HASHTAGS_MAX_ITEMS }).toEqual({
      TITLE_MAX_LENGTH: 200,
      BODY_MAX_LENGTH: 50_000,
      HASHTAG_MAX_LENGTH: 50,
      HASHTAGS_MAX_ITEMS: 10,
    });
    expect({ DEFAULT_PAGE, MAX_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE }).toEqual({
      DEFAULT_PAGE: 1,
      MAX_PAGE: 1000,
      DEFAULT_PAGE_SIZE: 10,
      MAX_PAGE_SIZE: 50,
    });
    expect(AUTHOR_NAME).toBe('Brian Fox');
    expect(POST_STATUSES).toEqual(['draft', 'published']);
  });

  it('fit the largest valid post within the JSON body limit', () => {
    const largestPost = {
      title: EMOJI.repeat(TITLE_MAX_LENGTH),
      body: EMOJI.repeat(BODY_MAX_LENGTH),
      // Three-byte characters, the widest a hashtag can contain.
      hashtags: Array.from(
        { length: HASHTAGS_MAX_ITEMS },
        (_, index) => `${'日'.repeat(HASHTAG_MAX_LENGTH - 1)}${index}`,
      ),
      status: 'published',
    };

    expect(() => parseBody(largestPost)).not.toThrow();
    expect(Buffer.byteLength(JSON.stringify(largestPost))).toBeLessThanOrEqual(
      JSON_BODY_LIMIT_BYTES,
    );
  });
});

describe('createPostBody', () => {
  it('defaults to no hashtags and the draft status', () => {
    expect(parseBody({ title: 'Hello', body: 'World' })).toEqual({
      title: 'Hello',
      body: 'World',
      hashtags: [],
      status: 'draft',
    });
  });

  describe('title', () => {
    it('is trimmed', () => {
      expect(parseBody({ title: '  Hello  ', body: 'B' }).title).toBe('Hello');
    });

    it('accepts up to 200 characters, counted as code points', () => {
      expect(parseBody({ title: 'a'.repeat(TITLE_MAX_LENGTH), body: 'B' }).title).toHaveLength(
        TITLE_MAX_LENGTH,
      );
      const emojiTitle = EMOJI.repeat(TITLE_MAX_LENGTH);
      expect(parseBody({ title: emojiTitle, body: 'B' }).title).toBe(emojiTitle);
    });

    it('is measured after trimming', () => {
      const title = `  ${'a'.repeat(TITLE_MAX_LENGTH)}  `;
      expect(parseBody({ title, body: 'B' }).title).toBe('a'.repeat(TITLE_MAX_LENGTH));
    });

    it.each([
      ['ASCII', 'a'.repeat(TITLE_MAX_LENGTH + 1)],
      ['emoji', EMOJI.repeat(TITLE_MAX_LENGTH + 1)],
    ])('rejects more than 200 characters (%s)', (_, title) => {
      expect(issuesOf(() => parseBody({ title, body: 'B' }))).toEqual([
        issue('body', 'title', 'too_big'),
      ]);
    });

    it.each(['', '   ', '\n\t '])('rejects the blank title %j', (title) => {
      expect(issuesOf(() => parseBody({ title, body: 'B' }))).toEqual([
        issue('body', 'title', 'too_small'),
      ]);
    });

    it('rejects a title that is not a string', () => {
      expect(issuesOf(() => parseBody({ title: 42, body: 'B' }))).toEqual([
        issue('body', 'title', 'invalid_type'),
      ]);
    });
  });

  describe('body', () => {
    it('is kept verbatim, surrounding whitespace included', () => {
      const body = '\n  # Heading\n\n    indented code  \n';
      expect(parseBody({ title: 'T', body }).body).toBe(body);
    });

    it('accepts up to 50,000 characters, counted as code points', () => {
      expect(parseBody({ title: 'T', body: 'a'.repeat(BODY_MAX_LENGTH) }).body).toHaveLength(
        BODY_MAX_LENGTH,
      );
      const emojiBody = EMOJI.repeat(BODY_MAX_LENGTH);
      expect(parseBody({ title: 'T', body: emojiBody }).body).toBe(emojiBody);
    });

    it('rejects more than 50,000 characters', () => {
      expect(
        issuesOf(() => parseBody({ title: 'T', body: 'a'.repeat(BODY_MAX_LENGTH + 1) })),
      ).toEqual([issue('body', 'body', 'too_big')]);
    });

    it('rejects a whitespace-only body', () => {
      expect(issuesOf(() => parseBody({ title: 'T', body: ' \n\t ' }))).toEqual([
        issue('body', 'body', 'invalid'),
      ]);
    });

    it('rejects an empty body', () => {
      expect(issuesOf(() => parseBody({ title: 'T', body: '' }))).toContainEqual(
        expect.objectContaining({ location: 'body', field: 'body' }),
      );
    });
  });

  describe('hashtags', () => {
    it('are normalized and de-duplicated, keeping the first occurrence', () => {
      const hashtags = ['#NodeJS', 'express', ' nodejs ', 'MongoDB', '#EXPRESS'];
      expect(parseBody({ title: 'T', body: 'B', hashtags }).hashtags).toEqual([
        'nodejs',
        'express',
        'mongodb',
      ]);
    });

    it('accept Unicode letters', () => {
      const hashtags = ['Café', '日本語', 'café'];
      expect(parseBody({ title: 'T', body: 'B', hashtags }).hashtags).toEqual(['café', '日本語']);
    });

    it('accept up to 10 items', () => {
      const hashtags = ELEVEN_HASHTAGS.slice(0, HASHTAGS_MAX_ITEMS);
      expect(parseBody({ title: 'T', body: 'B', hashtags }).hashtags).toEqual(hashtags);
    });

    it('reject more than 10 items', () => {
      expect(
        issuesOf(() => parseBody({ title: 'T', body: 'B', hashtags: ELEVEN_HASHTAGS })),
      ).toEqual([issue('body', 'hashtags', 'too_big')]);
    });

    it('accept a hashtag of 50 characters and reject one of 51', () => {
      const longest = 'a'.repeat(HASHTAG_MAX_LENGTH);
      expect(parseBody({ title: 'T', body: 'B', hashtags: [longest] }).hashtags).toEqual([longest]);
      expect(
        issuesOf(() => parseBody({ title: 'T', body: 'B', hashtags: [`${longest}a`] })),
      ).toEqual([issue('body', 'hashtags.0', 'invalid_format')]);
    });

    it('report each invalid hashtag at its index', () => {
      const hashtags = ['nodejs', 'node js', 'express', 'node-js'];
      expect(issuesOf(() => parseBody({ title: 'T', body: 'B', hashtags }))).toEqual([
        issue('body', 'hashtags.1', 'invalid_format'),
        issue('body', 'hashtags.3', 'invalid_format'),
      ]);
    });

    it('must be a list of strings', () => {
      expect(issuesOf(() => parseBody({ title: 'T', body: 'B', hashtags: 'nodejs' }))).toEqual([
        issue('body', 'hashtags', 'invalid_type'),
      ]);
      expect(issuesOf(() => parseBody({ title: 'T', body: 'B', hashtags: [42] }))).toEqual([
        issue('body', 'hashtags.0', 'invalid_type'),
      ]);
    });
  });

  describe('status', () => {
    it.each(POST_STATUSES)('accepts %s', (status) => {
      expect(parseBody({ title: 'T', body: 'B', status }).status).toBe(status);
    });

    it.each(['archived', 'Published', ''])('rejects %j', (status) => {
      expect(issuesOf(() => parseBody({ title: 'T', body: 'B', status }))).toEqual([
        issue('body', 'status', 'invalid_value'),
      ]);
    });
  });

  describe('the object', () => {
    it('requires title and body', () => {
      expect(issuesOf(() => parseBody({}))).toEqual([
        issue('body', 'title', 'required'),
        issue('body', 'body', 'required'),
      ]);
    });

    it('reports null values as invalid_type, not as missing', () => {
      expect(issuesOf(() => parseBody({ title: null, body: null }))).toEqual([
        issue('body', 'title', 'invalid_type'),
        issue('body', 'body', 'invalid_type'),
      ]);
    });

    it.each(['author', 'publishedAt', 'id', 'createdAt', 'updatedAt'])(
      'rejects the server-managed field %s as unknown_field',
      (field) => {
        expect(issuesOf(() => parseBody({ title: 'T', body: 'B', [field]: 'x' }))).toEqual([
          issue('body', field, 'unknown_field'),
        ]);
      },
    );

    it('reports one unknown_field detail per unknown key', () => {
      expect(
        issuesOf(() => parseBody({ title: 'T', body: 'B', author: 'Someone', slug: 'hello' })),
      ).toEqual([issue('body', 'author', 'unknown_field'), issue('body', 'slug', 'unknown_field')]);
    });

    it.each([
      ['an array', []],
      ['an array of values', ['title', 'body']],
      ['null', null],
      ['a string', 'title'],
      ['a number', 42],
    ])('rejects %s with field null', (_, value) => {
      expect(issuesOf(() => parseBody(value))).toEqual([issue('body', null, 'invalid_type')]);
    });

    it('reports every problem at once', () => {
      const issues = issuesOf(() =>
        parseBody({ title: ' ', body: ' ', hashtags: ['ok', 'not ok'], status: 'x', author: 'y' }),
      );
      expect(issues).toHaveLength(5);
      expect(issues).toEqual(
        expect.arrayContaining([
          issue('body', 'title', 'too_small'),
          issue('body', 'body', 'invalid'),
          issue('body', 'hashtags.1', 'invalid_format'),
          issue('body', 'status', 'invalid_value'),
          issue('body', 'author', 'unknown_field'),
        ]),
      );
    });
  });
});

describe('blogListQuery', () => {
  it('defaults to the first page of 10, without hashtag filter, matching any', () => {
    expect(parseBlogQuery({})).toEqual({ hashtags: [], match: 'any', page: 1, limit: 10 });
  });

  describe('hashtags', () => {
    it('accepts comma-separated values', () => {
      expect(parseBlogQuery({ hashtags: 'nodejs,express' }).hashtags).toEqual([
        'nodejs',
        'express',
      ]);
    });

    it('accepts repeated keys', () => {
      expect(parseBlogQuery({ hashtags: ['nodejs', 'express'] }).hashtags).toEqual([
        'nodejs',
        'express',
      ]);
    });

    it('merges comma-separated values and repeated keys', () => {
      expect(parseBlogQuery({ hashtags: ['nodejs,express', 'mongodb'] }).hashtags).toEqual([
        'nodejs',
        'express',
        'mongodb',
      ]);
    });

    it('normalizes and de-duplicates every value', () => {
      expect(
        parseBlogQuery({ hashtags: ['#NodeJS, nodejs ,EXPRESS', '#express'] }).hashtags,
      ).toEqual(['nodejs', 'express']);
    });

    it('drops empty segments', () => {
      expect(parseBlogQuery({ hashtags: 'nodejs,, ,express,' }).hashtags).toEqual([
        'nodejs',
        'express',
      ]);
    });

    it.each(['', ',', ' , ,'])('treats %j as no filter', (hashtags) => {
      expect(parseBlogQuery({ hashtags }).hashtags).toEqual([]);
    });

    it('accepts up to 10 values', () => {
      const hashtags = ELEVEN_HASHTAGS.slice(0, HASHTAGS_MAX_ITEMS);
      expect(parseBlogQuery({ hashtags: hashtags.join(',') }).hashtags).toEqual(hashtags);
    });

    it('rejects more than 10 values', () => {
      expect(issuesOf(() => parseBlogQuery({ hashtags: ELEVEN_HASHTAGS.join(',') }))).toEqual([
        issue('query', 'hashtags', 'too_big'),
      ]);
    });

    it('counts values after removing duplicates', () => {
      const hashtags = [...ELEVEN_HASHTAGS.slice(0, HASHTAGS_MAX_ITEMS), 'TAG0'];
      expect(parseBlogQuery({ hashtags }).hashtags).toHaveLength(HASHTAGS_MAX_ITEMS);
    });

    it.each(['node-js', 'nodejs,node.js', '##nodejs', 'a'.repeat(HASHTAG_MAX_LENGTH + 1)])(
      'reports the invalid value %j on the hashtags parameter',
      (hashtags) => {
        expect(issuesOf(() => parseBlogQuery({ hashtags }))).toEqual([
          issue('query', 'hashtags', 'invalid'),
        ]);
      },
    );
  });

  describe('match', () => {
    it.each(['any', 'all'])('accepts %s', (match) => {
      expect(parseBlogQuery({ match }).match).toBe(match);
    });

    it('rejects other modes', () => {
      expect(issuesOf(() => parseBlogQuery({ match: 'some' }))).toEqual([
        issue('query', 'match', 'invalid_value'),
      ]);
    });
  });

  describe('page and limit', () => {
    it('accept their bounds', () => {
      expect(parseBlogQuery({ page: '1', limit: '1' })).toMatchObject({ page: 1, limit: 1 });
      expect(parseBlogQuery({ page: '1000', limit: '50' })).toMatchObject({
        page: 1000,
        limit: 50,
      });
    });

    it.each([
      { field: 'page', value: '0', code: 'too_small' },
      { field: 'page', value: '1001', code: 'too_big' },
      { field: 'page', value: 'abc', code: 'invalid_format' },
      { field: 'page', value: '1e2', code: 'invalid_format' },
      { field: 'page', value: '-1', code: 'invalid_format' },
      { field: 'page', value: '1.5', code: 'invalid_format' },
      { field: 'page', value: ' 1', code: 'invalid_format' },
      { field: 'page', value: '', code: 'invalid_format' },
      { field: 'limit', value: '0', code: 'too_small' },
      { field: 'limit', value: '51', code: 'too_big' },
      { field: 'limit', value: '1001', code: 'too_big' },
      { field: 'limit', value: 'abc', code: 'invalid_format' },
      { field: 'limit', value: '1e2', code: 'invalid_format' },
    ])('reject $field=$value ($code), never clamping it', ({ field, value, code }) => {
      expect(issuesOf(() => parseBlogQuery({ [field]: value }))).toEqual([
        issue('query', field, code),
      ]);
    });

    it.each(['page', 'limit'])('reject a repeated %s parameter', (field) => {
      expect(issuesOf(() => parseBlogQuery({ [field]: ['1', '2'] }))).toEqual([
        issue('query', field, 'invalid_type'),
      ]);
    });
  });

  it.each(['status', 'author', 'hashtags[]', 'q'])(
    'rejects the unknown parameter %s',
    (parameter) => {
      expect(issuesOf(() => parseBlogQuery({ [parameter]: 'x' }))).toEqual([
        issue('query', parameter, 'unknown_field'),
      ]);
    },
  );
});

describe('cmsListQuery', () => {
  it('has the same defaults, without status filter', () => {
    expect(parseCmsQuery({})).toEqual({ hashtags: [], match: 'any', page: 1, limit: 10 });
  });

  it.each(POST_STATUSES)('accepts status=%s', (status) => {
    expect(parseCmsQuery({ status }).status).toBe(status);
  });

  it('rejects an unknown status', () => {
    expect(issuesOf(() => parseCmsQuery({ status: 'archived' }))).toEqual([
      issue('query', 'status', 'invalid_value'),
    ]);
  });

  it('shares the hashtag and pagination rules of the blog', () => {
    expect(
      parseCmsQuery({
        hashtags: ['#NodeJS', 'nodejs,express'],
        match: 'all',
        page: '2',
        limit: '5',
      }),
    ).toEqual({ hashtags: ['nodejs', 'express'], match: 'all', page: 2, limit: 5 });
    expect(issuesOf(() => parseCmsQuery({ hashtags: 'node-js', limit: '51' }))).toEqual([
      issue('query', 'hashtags', 'invalid'),
      issue('query', 'limit', 'too_big'),
    ]);
  });

  it('rejects unknown parameters', () => {
    expect(issuesOf(() => parseCmsQuery({ author: 'Brian Fox' }))).toEqual([
      issue('query', 'author', 'unknown_field'),
    ]);
  });
});

describe('postIdParams', () => {
  it.each(['674f1c2ab1c2d3e4f5a6b7c8', '674F1C2AB1C2D3E4F5A6B7C8'])('accepts %s', (id) => {
    expect(parseParams({ id })).toEqual({ id });
  });

  it.each([
    ['too short', '674f1c2ab1c2d3e4f5a6b7c'],
    ['too long', '674f1c2ab1c2d3e4f5a6b7c8d'],
    ['not hexadecimal', '674f1c2ab1c2d3e4f5a6b7cz'],
    ['12 characters (an ObjectId byte string)', 'aaaaaaaaaaaa'],
    ['empty', ''],
  ])('rejects an id that is %s', (_, id) => {
    expect(issuesOf(() => parseParams({ id }))).toEqual([issue('params', 'id', 'invalid_format')]);
  });
});
