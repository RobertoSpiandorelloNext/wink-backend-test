import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { auth, createTestApp } from '../helpers/app.js';
import { useTestDatabase } from '../helpers/database.js';
import { createDraft, createPublished, MALFORMED_IDS, UNKNOWN_ID } from '../helpers/factories.js';
import {
  expectError,
  expectTimestampWithin,
  expectValidationError,
  ISO_TIMESTAMP,
  listOf,
  postOf,
} from '../helpers/responses.js';

useTestDatabase();
const app = createTestApp();

function publish(id: string) {
  return request(app).post(`/api/v1/cms/posts/${id}/publish`).set(auth());
}

function remove(id: string) {
  return request(app).delete(`/api/v1/cms/posts/${id}`).set(auth());
}

function getFromCms(id: string) {
  return request(app).get(`/api/v1/cms/posts/${id}`).set(auth());
}

describe('POST /api/v1/cms/posts/:id/publish', () => {
  it('publishes a draft, setting publishedAt to now and keeping the rest of the post', async () => {
    const draft = await createDraft({ title: 'Ready', hashtags: ['nodejs'] });

    const before = Date.now();
    const res = await publish(draft.id);
    const after = Date.now();

    expect(res.status).toBe(200);
    const published = postOf(res);
    expect(published).toEqual({
      ...draft,
      status: 'published',
      publishedAt: published.publishedAt,
      updatedAt: published.updatedAt,
    });
    expectTimestampWithin(published.publishedAt, before, after);
    expect(published.updatedAt).toMatch(ISO_TIMESTAMP);
  });

  it('makes the post visible on the blog', async () => {
    const draft = await createDraft();
    const published = postOf(await publish(draft.id));

    const list = await request(app).get('/api/v1/blog/posts');
    const detail = await request(app).get(`/api/v1/blog/posts/${draft.id}`);

    expect(listOf(list).data).toEqual([published]);
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual({ data: published });
  });

  it('is idempotent: publishing again returns the post unchanged', async () => {
    const draft = await createDraft();
    const first = postOf(await publish(draft.id));

    const res = await publish(draft.id);

    expect(res.status).toBe(200);
    expect(postOf(res)).toEqual(first);
  });

  it('keeps the publication date of a post created as published', async () => {
    const post = await createPublished();

    const res = await publish(post.id);

    expect(res.status).toBe(200);
    expect(postOf(res)).toEqual(post);
  });

  it('sets a single publication date when called concurrently', async () => {
    const draft = await createDraft();

    const responses = await Promise.all(Array.from({ length: 5 }, () => publish(draft.id)));

    expect(responses.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
    const dates = new Set(responses.map((res) => postOf(res).publishedAt));
    expect(dates.size).toBe(1);
    expect(dates).toContain(postOf(await getFromCms(draft.id)).publishedAt);
  });

  it('ignores a request body, even malformed JSON', async () => {
    const draft = await createDraft({ title: 'Original' });

    const res = await publish(draft.id).set('Content-Type', 'application/json').send('{bad');

    expect(res.status).toBe(200);
    expect(postOf(res)).toMatchObject({ id: draft.id, title: 'Original', status: 'published' });
  });

  it('ignores fields sent in the body', async () => {
    const draft = await createDraft({ title: 'Original' });

    const before = Date.now();
    const res = await publish(draft.id).send({
      title: 'Changed',
      status: 'draft',
      publishedAt: '2000-01-01T00:00:00.000Z',
    });
    const after = Date.now();

    expect(res.status).toBe(200);
    expect(postOf(res)).toMatchObject({ title: 'Original', status: 'published' });
    expectTimestampWithin(postOf(res).publishedAt, before, after);
  });

  it('does not require a JSON content type', async () => {
    const draft = await createDraft();

    const res = await publish(draft.id).set('Content-Type', 'text/plain').send('publish it');

    expect(res.status).toBe(200);
  });

  it('returns 404 POST_NOT_FOUND for an unknown id', async () => {
    expectError(await publish(UNKNOWN_ID), 404, 'POST_NOT_FOUND');
  });

  it.each(MALFORMED_IDS)('rejects the malformed id %j', async (id) => {
    expectValidationError(await publish(id), [
      { location: 'params', field: 'id', code: 'invalid_format' },
    ]);
  });
});

describe('DELETE /api/v1/cms/posts/:id', () => {
  it('deletes a draft, answering 204 with an empty body', async () => {
    const draft = await createDraft();

    const res = await remove(draft.id);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(res.get('Content-Type')).toBeUndefined();
  });

  it('makes the post unreachable: GET, DELETE and publish then answer 404', async () => {
    const draft = await createDraft();
    expect((await remove(draft.id)).status).toBe(204);

    expectError(await getFromCms(draft.id), 404, 'POST_NOT_FOUND');
    expectError(await remove(draft.id), 404, 'POST_NOT_FOUND');
    expectError(await publish(draft.id), 404, 'POST_NOT_FOUND');
  });

  it('removes a published post from the blog', async () => {
    const post = await createPublished();
    expect((await remove(post.id)).status).toBe(204);

    const list = await request(app).get('/api/v1/blog/posts');
    const detail = await request(app).get(`/api/v1/blog/posts/${post.id}`);

    expect(listOf(list)).toEqual({
      data: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
    expectError(detail, 404, 'POST_NOT_FOUND');
  });

  it('deletes only the targeted post', async () => {
    const kept = await createDraft({ title: 'kept' });
    const deleted = await createDraft({ title: 'deleted' });

    expect((await remove(deleted.id)).status).toBe(204);

    const res = await request(app).get('/api/v1/cms/posts').set(auth());
    expect(listOf(res).data).toEqual([kept]);
  });

  it('ignores a request body, even malformed JSON', async () => {
    const draft = await createDraft();

    const res = await remove(draft.id).set('Content-Type', 'application/json').send('{bad');

    expect(res.status).toBe(204);
  });

  it('returns 404 POST_NOT_FOUND for an unknown id', async () => {
    expectError(await remove(UNKNOWN_ID), 404, 'POST_NOT_FOUND');
  });

  it.each(MALFORMED_IDS)('rejects the malformed id %j', async (id) => {
    expectValidationError(await remove(id), [
      { location: 'params', field: 'id', code: 'invalid_format' },
    ]);
  });
});
