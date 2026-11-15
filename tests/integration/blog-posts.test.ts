import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../helpers/app.js';
import { useTestDatabase } from '../helpers/database.js';
import {
  createDraft,
  createPublished,
  insertPost,
  MALFORMED_IDS,
  UNKNOWN_ID,
} from '../helpers/factories.js';
import {
  errorOf,
  expectError,
  expectValidationError,
  idsOf,
  listOf,
  titlesOf,
} from '../helpers/responses.js';

useTestDatabase();
const app = createTestApp();

/** Ids sorted the way the API breaks ties: highest (most recently generated) first. */
const byIdDescending = (ids: readonly string[]): string[] => [...ids].sort().reverse();

describe('GET /api/v1/blog/posts', () => {
  it('returns an empty first page when nothing is published', async () => {
    await createDraft();

    const res = await request(app).get('/api/v1/blog/posts');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it('lists published posts only, never drafts', async () => {
    const published = await createPublished({ title: 'Published' });
    await createDraft({ title: 'Draft' });

    const res = await request(app).get('/api/v1/blog/posts');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [published],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
  });

  it('orders posts by publishedAt, newest first, breaking ties by id, newest first', async () => {
    const tie = new Date('2026-03-01T12:00:00.000Z');
    const oldest = await insertPost({ publishedAt: new Date('2026-01-01T00:00:00.000Z') });
    const tied = [
      await insertPost({ publishedAt: tie }),
      await insertPost({ publishedAt: tie }),
      await insertPost({ publishedAt: tie }),
    ];
    const newest = await insertPost({ publishedAt: new Date('2026-06-01T00:00:00.000Z') });

    const res = await request(app).get('/api/v1/blog/posts');

    expect(idsOf(res)).toEqual([newest, ...byIdDescending(tied), oldest]);
  });

  it('orders by publication date, not by creation date', async () => {
    await insertPost({
      title: 'written first, published last',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      publishedAt: new Date('2026-05-01T00:00:00.000Z'),
    });
    await insertPost({
      title: 'written last, published first',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
      publishedAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    const res = await request(app).get('/api/v1/blog/posts');

    expect(titlesOf(res)).toEqual([
      'written first, published last',
      'written last, published first',
    ]);
  });

  describe('pagination', () => {
    /** Five published posts, one per day; returns their ids, newest first. */
    async function insertFiveDays(): Promise<string[]> {
      const ids: string[] = [];
      for (let day = 1; day <= 5; day += 1) {
        ids.unshift(await insertPost({ publishedAt: new Date(Date.UTC(2026, 0, day)) }));
      }
      return ids;
    }

    it('returns the requested page with total and totalPages', async () => {
      const ids = await insertFiveDays();

      const first = await request(app).get('/api/v1/blog/posts?page=1&limit=2');
      const last = await request(app).get('/api/v1/blog/posts?page=3&limit=2');

      expect(idsOf(first)).toEqual(ids.slice(0, 2));
      expect(listOf(first).pagination).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });
      expect(idsOf(last)).toEqual(ids.slice(4));
      expect(listOf(last).pagination).toEqual({ page: 3, limit: 2, total: 5, totalPages: 3 });
    });

    it('returns an empty page past the end, with the same totals', async () => {
      await insertFiveDays();

      const res = await request(app).get('/api/v1/blog/posts?page=4&limit=2');

      expect(res.status).toBe(200);
      expect(listOf(res)).toEqual({
        data: [],
        pagination: { page: 4, limit: 2, total: 5, totalPages: 3 },
      });
    });

    it('defaults to the first page of 10 posts', async () => {
      for (let index = 0; index < 12; index += 1) {
        await insertPost();
      }

      const res = await request(app).get('/api/v1/blog/posts');

      expect(listOf(res).data).toHaveLength(10);
      expect(listOf(res).pagination).toEqual({ page: 1, limit: 10, total: 12, totalPages: 2 });
    });

    it('walks posts published at the same time without gaps or duplicates', async () => {
      const publishedAt = new Date('2026-03-01T12:00:00.000Z');
      const ids: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        ids.push(await insertPost({ publishedAt }));
      }

      const seen: string[] = [];
      for (const page of [1, 2, 3]) {
        seen.push(...idsOf(await request(app).get(`/api/v1/blog/posts?limit=2&page=${page}`)));
      }

      expect(seen).toEqual(byIdDescending(ids));
    });

    it('accepts the largest page and limit', async () => {
      const res = await request(app).get('/api/v1/blog/posts?page=1000&limit=50');

      expect(res.status).toBe(200);
      expect(listOf(res).pagination).toEqual({ page: 1000, limit: 50, total: 0, totalPages: 0 });
    });
  });

  describe('hashtag filter', () => {
    beforeEach(async () => {
      await createPublished({ title: 'A', hashtags: ['nodejs', 'express'] });
      await createPublished({ title: 'B', hashtags: ['NodeJS'] });
      await createPublished({ title: 'C', hashtags: ['express', 'mongodb'] });
      await createPublished({ title: 'D', hashtags: ['typescript'] });
      await createPublished({ title: 'untagged' });
      await createDraft({
        title: 'draft',
        hashtags: ['nodejs', 'express', 'mongodb', 'typescript'],
      });
    });

    /** Titles of the posts listed for `query`, sorted: these tests are about filtering. */
    async function titlesFor(query: string): Promise<string[]> {
      const res = await request(app).get(`/api/v1/blog/posts?${query}`);
      expect(res.status, res.text).toBe(200);
      return titlesOf(res).sort();
    }

    it('lists the posts tagged with a hashtag', async () => {
      expect(await titlesFor('hashtags=nodejs')).toEqual(['A', 'B']);
    });

    it('matches any of the hashtags by default', async () => {
      expect(await titlesFor('hashtags=nodejs,mongodb')).toEqual(['A', 'B', 'C']);
      expect(await titlesFor('hashtags=nodejs,mongodb&match=any')).toEqual(['A', 'B', 'C']);
    });

    it('matches all of the hashtags with match=all', async () => {
      expect(await titlesFor('hashtags=nodejs,express&match=all')).toEqual(['A']);
      expect(await titlesFor('hashtags=nodejs,mongodb&match=all')).toEqual([]);
    });

    it('accepts comma-separated values, repeated keys, or both', async () => {
      expect(await titlesFor('hashtags=mongodb,typescript')).toEqual(['C', 'D']);
      expect(await titlesFor('hashtags=mongodb&hashtags=typescript')).toEqual(['C', 'D']);
      expect(await titlesFor('hashtags=nodejs,mongodb&hashtags=typescript')).toEqual([
        'A',
        'B',
        'C',
        'D',
      ]);
      expect(await titlesFor('hashtags=nodejs&hashtags=express&match=all')).toEqual(['A']);
    });

    it('matches case-insensitively and ignores a leading # sent as %23', async () => {
      expect(await titlesFor('hashtags=NODEJS')).toEqual(['A', 'B']);
      expect(await titlesFor('hashtags=%23nodejs')).toEqual(['A', 'B']);
      expect(await titlesFor('hashtags=%23NodeJS,%23Express&match=all')).toEqual(['A']);
    });

    it('never includes drafts, even when they match', async () => {
      expect(await titlesFor('hashtags=nodejs,express,mongodb,typescript&match=any')).toEqual([
        'A',
        'B',
        'C',
        'D',
      ]);
    });

    it('treats an empty value as no filter', async () => {
      const everything = ['A', 'B', 'C', 'D', 'untagged'];
      expect(await titlesFor('hashtags=')).toEqual(everything);
      expect(await titlesFor('hashtags=,,')).toEqual(everything);
    });

    it('ignores match when no hashtags are given', async () => {
      expect(await titlesFor('match=all')).toEqual(['A', 'B', 'C', 'D', 'untagged']);
    });

    it('counts only matching posts in the pagination', async () => {
      const res = await request(app).get('/api/v1/blog/posts?hashtags=nodejs&limit=1');

      expect(listOf(res).pagination).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
    });

    it('accepts up to 10 hashtags', async () => {
      const tags = ['nodejs', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'];
      expect(await titlesFor(`hashtags=${tags.join(',')}`)).toEqual(['A', 'B']);
    });

    it('rejects more than 10 hashtags', async () => {
      const tags = ['nodejs', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10'];

      const res = await request(app).get(`/api/v1/blog/posts?hashtags=${tags.join(',')}`);

      expectValidationError(res, [{ location: 'query', field: 'hashtags', code: 'too_big' }]);
    });

    it.each(['node-js', 'nodejs,node.js', '%23%23nodejs', 'a'.repeat(51)])(
      'rejects the invalid hashtag %j',
      async (value) => {
        const res = await request(app).get(`/api/v1/blog/posts?hashtags=${value}`);

        expectValidationError(res, [{ location: 'query', field: 'hashtags', code: 'invalid' }]);
      },
    );

    it('rejects an unknown match mode', async () => {
      const res = await request(app).get('/api/v1/blog/posts?hashtags=nodejs&match=some');

      expectValidationError(res, [{ location: 'query', field: 'match', code: 'invalid_value' }]);
    });
  });

  describe('query validation', () => {
    it('rejects unknown parameters', async () => {
      const res = await request(app).get('/api/v1/blog/posts?sort=title');

      expectValidationError(res, [{ location: 'query', field: 'sort', code: 'unknown_field' }]);
    });

    it('does not accept a status parameter, so drafts cannot be requested', async () => {
      const res = await request(app).get('/api/v1/blog/posts?status=draft');

      expectValidationError(res, [{ location: 'query', field: 'status', code: 'unknown_field' }]);
    });

    it('rejects bracketed hashtags[] keys', async () => {
      const res = await request(app).get('/api/v1/blog/posts?hashtags[]=nodejs');

      expectValidationError(res, [
        { location: 'query', field: 'hashtags[]', code: 'unknown_field' },
      ]);
    });

    it.each([
      { field: 'page', value: '0', code: 'too_small' },
      { field: 'page', value: '1001', code: 'too_big' },
      { field: 'page', value: 'abc', code: 'invalid_format' },
      { field: 'page', value: '1e2', code: 'invalid_format' },
      { field: 'page', value: '-1', code: 'invalid_format' },
      { field: 'page', value: '', code: 'invalid_format' },
      { field: 'limit', value: '0', code: 'too_small' },
      { field: 'limit', value: '51', code: 'too_big' },
      { field: 'limit', value: '1001', code: 'too_big' },
      { field: 'limit', value: 'abc', code: 'invalid_format' },
      { field: 'limit', value: '1e2', code: 'invalid_format' },
    ])('rejects $field=$value', async ({ field, value, code }) => {
      const res = await request(app).get(`/api/v1/blog/posts?${field}=${value}`);

      expectValidationError(res, [{ location: 'query', field, code }]);
    });

    it('rejects a repeated page parameter', async () => {
      const res = await request(app).get('/api/v1/blog/posts?page=1&page=2');

      expectValidationError(res, [{ location: 'query', field: 'page', code: 'invalid_type' }]);
    });
  });
});

describe('GET /api/v1/blog/posts/:id', () => {
  it('returns a published post, exactly as the CMS created it', async () => {
    const post = await createPublished({ title: 'Hello', hashtags: ['nodejs'] });

    const res = await request(app).get(`/api/v1/blog/posts/${post.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: post });
  });

  it('accepts the id in upper-case hexadecimal', async () => {
    const post = await createPublished();

    const res = await request(app).get(`/api/v1/blog/posts/${post.id.toUpperCase()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: post });
  });

  it('hides a draft behind the same 404 as a missing post', async () => {
    const draft = await createDraft();

    const draftRes = await request(app).get(`/api/v1/blog/posts/${draft.id}`);
    const missingRes = await request(app).get(`/api/v1/blog/posts/${UNKNOWN_ID}`);

    const { requestId: _draftRequestId, ...draftError } = expectError(
      draftRes,
      404,
      'POST_NOT_FOUND',
    );
    const { requestId: _missingRequestId, ...missingError } = errorOf(missingRes);
    expect(draftError).toEqual(missingError);
  });

  it('returns 404 POST_NOT_FOUND for an unknown id', async () => {
    const res = await request(app).get(`/api/v1/blog/posts/${UNKNOWN_ID}`);

    expectError(res, 404, 'POST_NOT_FOUND');
  });

  it.each(MALFORMED_IDS)('rejects the malformed id %j', async (id) => {
    const res = await request(app).get(`/api/v1/blog/posts/${id}`);

    expectValidationError(res, [{ location: 'params', field: 'id', code: 'invalid_format' }]);
  });
});
