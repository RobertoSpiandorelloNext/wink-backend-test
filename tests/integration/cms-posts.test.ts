import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  BODY_MAX_LENGTH,
  HASHTAG_MAX_LENGTH,
  HASHTAGS_MAX_ITEMS,
  TITLE_MAX_LENGTH,
} from '../../src/posts/post.constants.js';
import { auth, createTestApp } from '../helpers/app.js';
import { useTestDatabase } from '../helpers/database.js';
import {
  createDraft,
  createPublished,
  insertPost,
  MALFORMED_IDS,
  UNKNOWN_ID,
} from '../helpers/factories.js';
import {
  expectError,
  expectTimestampWithin,
  expectValidationError,
  idsOf,
  listOf,
  OBJECT_ID,
  postOf,
  titlesOf,
} from '../helpers/responses.js';

useTestDatabase();
const app = createTestApp();

/** U+1F600: one character, two UTF-16 code units, four bytes of UTF-8. */
const EMOJI = '😀';

/** 11 distinct, valid hashtags. */
const ELEVEN_HASHTAGS = Array.from({ length: 11 }, (_, index) => `tag${index}`);

function create(body: string | object) {
  return request(app).post('/api/v1/cms/posts').set(auth()).send(body);
}

async function totalPosts(): Promise<number> {
  return listOf(await request(app).get('/api/v1/cms/posts').set(auth())).pagination.total;
}

describe('POST /api/v1/cms/posts', () => {
  it('creates a draft by default, authored by Brian Fox', async () => {
    const before = Date.now();
    const res = await create({ title: 'Hello', body: 'World' });
    const after = Date.now();

    expect(res.status).toBe(201);
    const post = postOf(res);
    expect(post).toEqual({
      id: post.id,
      title: 'Hello',
      body: 'World',
      hashtags: [],
      status: 'draft',
      author: 'Brian Fox',
      publishedAt: null,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    });
    expect(post.id).toMatch(OBJECT_ID);
    expectTimestampWithin(post.createdAt, before, after);
    expectTimestampWithin(post.updatedAt, before, after);
  });

  it('publishes the post at once when created with status "published"', async () => {
    const before = Date.now();
    const res = await create({ title: 'Hello', body: 'World', status: 'published' });
    const after = Date.now();

    expect(res.status).toBe(201);
    expect(postOf(res).status).toBe('published');
    expectTimestampWithin(postOf(res).publishedAt, before, after);
  });

  it('answers with a Location header that resolves to the new post', async () => {
    const res = await create({ title: 'Hello', body: 'World' });
    const post = postOf(res);
    expect(res.get('Location')).toBe(`/api/v1/cms/posts/${post.id}`);

    const fetched = await request(app)
      .get(res.get('Location') ?? '')
      .set(auth());

    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual({ data: post });
  });

  it('normalizes hashtags and drops duplicates, keeping the first occurrence', async () => {
    const res = await create({
      title: 'T',
      body: 'B',
      hashtags: ['#NodeJS', 'express', ' nodejs ', 'MongoDB', '#EXPRESS'],
    });

    expect(res.status).toBe(201);
    expect(postOf(res).hashtags).toEqual(['nodejs', 'express', 'mongodb']);
  });

  it('accepts Unicode hashtags, stored in NFC form', async () => {
    const res = await create({ title: 'T', body: 'B', hashtags: ['Café', '日本語', 'café'] });

    expect(res.status).toBe(201);
    expect(postOf(res).hashtags).toEqual(['café', '日本語']);
  });

  it('trims the title and stores the body verbatim', async () => {
    const body = '\n  # Heading\n\n    indented code  \n';

    const res = await create({ title: '  Spaced out  ', body });

    expect(res.status).toBe(201);
    expect(postOf(res)).toMatchObject({ title: 'Spaced out', body });
  });

  describe('limits', () => {
    it.each([
      ['ASCII', 'a'.repeat(TITLE_MAX_LENGTH)],
      ['emoji, counted as characters', EMOJI.repeat(TITLE_MAX_LENGTH)],
    ])('accepts a 200-character title (%s)', async (_, title) => {
      const res = await create({ title, body: 'B' });

      expect(res.status).toBe(201);
      expect(postOf(res).title).toBe(title);
    });

    it('rejects a 201-character title', async () => {
      const res = await create({ title: 'a'.repeat(TITLE_MAX_LENGTH + 1), body: 'B' });

      expectValidationError(res, [{ location: 'body', field: 'title', code: 'too_big' }]);
    });

    it.each(['', '   ', '\n\t'])('rejects the blank title %j', async (title) => {
      const res = await create({ title, body: 'B' });

      expectValidationError(res, [{ location: 'body', field: 'title', code: 'too_small' }]);
    });

    it('accepts a 50,000-character body', async () => {
      const body = 'a'.repeat(BODY_MAX_LENGTH);
      const res = await create({ title: 'T', body });

      expect(res.status).toBe(201);
      expect(postOf(res).body).toBe(body);
    });

    // The 50,000-character limit for four-byte characters is covered by the schema unit tests,
    // and the request-size budget by the JSON body limit test; this one checks the round trip.
    it('stores and returns four-byte characters unchanged', async () => {
      const body = EMOJI.repeat(1_000);
      const res = await create({ title: 'T', body });

      expect(res.status).toBe(201);
      expect(postOf(res).body).toBe(body);
    });

    it('rejects a 50,001-character body', async () => {
      const res = await create({ title: 'T', body: 'a'.repeat(BODY_MAX_LENGTH + 1) });

      expectValidationError(res, [{ location: 'body', field: 'body', code: 'too_big' }]);
    });

    it('rejects a whitespace-only body', async () => {
      const res = await create({ title: 'T', body: ' \n\t ' });

      expectValidationError(res, [{ location: 'body', field: 'body', code: 'invalid' }]);
    });

    it('accepts 10 hashtags', async () => {
      const hashtags = ELEVEN_HASHTAGS.slice(0, HASHTAGS_MAX_ITEMS);

      const res = await create({ title: 'T', body: 'B', hashtags });

      expect(res.status).toBe(201);
      expect(postOf(res).hashtags).toEqual(hashtags);
    });

    it('rejects 11 hashtags', async () => {
      const res = await create({ title: 'T', body: 'B', hashtags: ELEVEN_HASHTAGS });

      expectValidationError(res, [{ location: 'body', field: 'hashtags', code: 'too_big' }]);
    });

    it('accepts a 50-character hashtag', async () => {
      const hashtag = 'a'.repeat(HASHTAG_MAX_LENGTH);

      const res = await create({ title: 'T', body: 'B', hashtags: [hashtag] });

      expect(res.status).toBe(201);
      expect(postOf(res).hashtags).toEqual([hashtag]);
    });

    it('rejects a 51-character hashtag', async () => {
      const res = await create({
        title: 'T',
        body: 'B',
        hashtags: ['a'.repeat(HASHTAG_MAX_LENGTH + 1)],
      });

      expectValidationError(res, [
        { location: 'body', field: 'hashtags.0', code: 'invalid_format' },
      ]);
    });
  });

  describe('validation', () => {
    it('requires title and body', async () => {
      const res = await create({});

      expectValidationError(res, [
        { location: 'body', field: 'title', code: 'required' },
        { location: 'body', field: 'body', code: 'required' },
      ]);
    });

    // Content-Length: 0 without Content-Type is what fetch, browsers and supertest send for a
    // POST without a body.
    it('treats a request without a body as an empty object', async () => {
      const res = await request(app)
        .post('/api/v1/cms/posts')
        .set(auth())
        .set('Content-Length', '0');

      expectValidationError(res, [
        { location: 'body', field: 'title', code: 'required' },
        { location: 'body', field: 'body', code: 'required' },
      ]);
    });

    it.each([
      ['author', 'Someone Else'],
      ['publishedAt', '2020-01-01T00:00:00.000Z'],
      ['id', '674f1c2ab1c2d3e4f5a6b7c8'],
      ['_id', '674f1c2ab1c2d3e4f5a6b7c8'],
      ['createdAt', '2020-01-01T00:00:00.000Z'],
      ['updatedAt', '2020-01-01T00:00:00.000Z'],
    ])('rejects the server-managed field %s as unknown_field', async (field, value) => {
      const res = await create({ title: 'T', body: 'B', [field]: value });

      expectValidationError(res, [{ location: 'body', field, code: 'unknown_field' }]);
    });

    it('reports one unknown_field detail per unknown key', async () => {
      const res = await create({ title: 'T', body: 'B', author: 'Someone Else', slug: 'hello' });

      expectValidationError(res, [
        { location: 'body', field: 'author', code: 'unknown_field' },
        { location: 'body', field: 'slug', code: 'unknown_field' },
      ]);
    });

    it('reports an invalid hashtag at its index', async () => {
      const res = await create({ title: 'T', body: 'B', hashtags: ['nodejs', 'node-js'] });

      expectValidationError(res, [
        { location: 'body', field: 'hashtags.1', code: 'invalid_format' },
      ]);
    });

    it('rejects an unknown status', async () => {
      const res = await create({ title: 'T', body: 'B', status: 'archived' });

      expectValidationError(res, [{ location: 'body', field: 'status', code: 'invalid_value' }]);
    });

    it.each([
      ['an empty array', []],
      ['an array of values', ['title', 'body']],
    ])('rejects %s as the body, with field null', async (_, body) => {
      const res = await create(body);

      expectValidationError(res, [{ location: 'body', field: null, code: 'invalid_type' }]);
    });

    it('stores nothing when the request is invalid', async () => {
      expect((await create({ title: 'T', body: ' ' })).status).toBe(400);
      expect((await create({ title: 'T', body: 'B', author: 'Someone Else' })).status).toBe(400);

      expect(await totalPosts()).toBe(0);
    });
  });
});

describe('GET /api/v1/cms/posts', () => {
  async function titlesFor(query: string): Promise<string[]> {
    const res = await request(app).get(`/api/v1/cms/posts?${query}`).set(auth());
    expect(res.status, res.text).toBe(200);
    return titlesOf(res).sort();
  }

  it('lists drafts and published posts', async () => {
    const draft = await createDraft({ title: 'draft' });
    const published = await createPublished({ title: 'published' });

    const res = await request(app).get('/api/v1/cms/posts').set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [published, draft],
      pagination: { page: 1, limit: 10, total: 2, totalPages: 1 },
    });
  });

  it('orders posts by creation date, newest first, whatever their publication date', async () => {
    await insertPost({
      title: 'created first',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      publishedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    await insertPost({
      title: 'created last',
      status: 'draft',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    await insertPost({
      title: 'created second',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
      publishedAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    const res = await request(app).get('/api/v1/cms/posts').set(auth());

    expect(titlesOf(res)).toEqual(['created last', 'created second', 'created first']);
  });

  it('breaks creation date ties by id, newest first', async () => {
    const createdAt = new Date('2026-03-01T12:00:00.000Z');
    const ids = [
      await insertPost({ createdAt }),
      await insertPost({ createdAt, status: 'draft' }),
      await insertPost({ createdAt }),
    ];

    const res = await request(app).get('/api/v1/cms/posts').set(auth());

    expect(idsOf(res)).toEqual([...ids].sort().reverse());
  });

  it.each(['draft', 'published'])('filters by status=%s', async (status) => {
    await createDraft({ title: 'draft' });
    await createPublished({ title: 'published' });

    const res = await request(app).get(`/api/v1/cms/posts?status=${status}`).set(auth());

    expect(titlesOf(res)).toEqual([status]);
    expect(listOf(res).pagination.total).toBe(1);
  });

  it('filters by hashtags, drafts included', async () => {
    await createDraft({ title: 'draft', hashtags: ['nodejs'] });
    await createPublished({ title: 'published', hashtags: ['NodeJS', 'express'] });
    await createPublished({ title: 'other', hashtags: ['express'] });

    expect(await titlesFor('hashtags=%23NodeJS')).toEqual(['draft', 'published']);
    expect(await titlesFor('hashtags=nodejs,express&match=all')).toEqual(['published']);
    expect(await titlesFor('hashtags=nodejs&hashtags=express')).toEqual([
      'draft',
      'other',
      'published',
    ]);
  });

  it('combines the status and hashtag filters', async () => {
    await createDraft({ title: 'tagged draft', hashtags: ['nodejs'] });
    await createDraft({ title: 'untagged draft' });
    await createPublished({ title: 'tagged published', hashtags: ['nodejs'] });

    expect(await titlesFor('status=draft&hashtags=nodejs')).toEqual(['tagged draft']);
  });

  it('paginates', async () => {
    await createDraft({ title: 'first' });
    await createPublished({ title: 'second' });
    await createDraft({ title: 'third' });

    const res = await request(app).get('/api/v1/cms/posts?page=2&limit=2').set(auth());

    expect(titlesOf(res)).toEqual(['first']);
    expect(listOf(res).pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  it.each([
    { query: 'status=archived', field: 'status', code: 'invalid_value' },
    { query: 'author=Brian%20Fox', field: 'author', code: 'unknown_field' },
    { query: 'hashtags=node-js', field: 'hashtags', code: 'invalid' },
    { query: `hashtags=${ELEVEN_HASHTAGS.join(',')}`, field: 'hashtags', code: 'too_big' },
    { query: 'match=none', field: 'match', code: 'invalid_value' },
    { query: 'page=0', field: 'page', code: 'too_small' },
    { query: 'limit=51', field: 'limit', code: 'too_big' },
    { query: 'page=1e2', field: 'page', code: 'invalid_format' },
    { query: 'limit=10&limit=20', field: 'limit', code: 'invalid_type' },
  ])('rejects ?$query', async ({ query, field, code }) => {
    const res = await request(app).get(`/api/v1/cms/posts?${query}`).set(auth());

    expectValidationError(res, [{ location: 'query', field, code }]);
  });
});

describe('GET /api/v1/cms/posts/:id', () => {
  it('returns a draft', async () => {
    const draft = await createDraft({ title: 'Work in progress', hashtags: ['wip'] });

    const res = await request(app).get(`/api/v1/cms/posts/${draft.id}`).set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: draft });
  });

  it('returns a published post', async () => {
    const post = await createPublished();

    const res = await request(app).get(`/api/v1/cms/posts/${post.id}`).set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: post });
  });

  it('returns 404 POST_NOT_FOUND for an unknown id', async () => {
    const res = await request(app).get(`/api/v1/cms/posts/${UNKNOWN_ID}`).set(auth());

    expectError(res, 404, 'POST_NOT_FOUND');
  });

  it.each(MALFORMED_IDS)('rejects the malformed id %j', async (id) => {
    const res = await request(app).get(`/api/v1/cms/posts/${id}`).set(auth());

    expectValidationError(res, [{ location: 'params', field: 'id', code: 'invalid_format' }]);
  });
});
