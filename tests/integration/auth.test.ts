import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { auth, createTestApp, TEST_TOKEN } from '../helpers/app.js';
import { useTestDatabase } from '../helpers/database.js';
import { UNKNOWN_ID } from '../helpers/factories.js';
import { expectError, postOf } from '../helpers/responses.js';

useTestDatabase();
const app = createTestApp();

const CHALLENGE = 'Bearer realm="cms"';
const INVALID_TOKEN_CHALLENGE = 'Bearer realm="cms", error="invalid_token"';

/** One request per CMS route family, sent without credentials unless the test adds them. */
const CMS_ROUTES = [
  { route: 'GET /api/v1/cms/posts', send: () => request(app).get('/api/v1/cms/posts') },
  {
    route: 'POST /api/v1/cms/posts',
    send: () => request(app).post('/api/v1/cms/posts').send({ title: 'T', body: 'B' }),
  },
  {
    route: 'GET /api/v1/cms/posts/:id',
    send: () => request(app).get(`/api/v1/cms/posts/${UNKNOWN_ID}`),
  },
  {
    route: 'DELETE /api/v1/cms/posts/:id',
    send: () => request(app).delete(`/api/v1/cms/posts/${UNKNOWN_ID}`),
  },
  {
    route: 'POST /api/v1/cms/posts/:id/publish',
    send: () => request(app).post(`/api/v1/cms/posts/${UNKNOWN_ID}/publish`),
  },
];

describe.each(CMS_ROUTES)('$route', ({ send }) => {
  it('requires a token: 401 with a Bearer challenge, not cacheable', async () => {
    const res = await send();

    expectError(res, 401, 'UNAUTHORIZED');
    expect(res.get('WWW-Authenticate')).toBe(CHALLENGE);
    expect(res.get('Cache-Control')).toBe('no-store');
  });

  it.each([
    ['another scheme', 'Basic dGVzdDp0ZXN0'],
    ['the scheme without a token', 'Bearer'],
    ['the token without a scheme', TEST_TOKEN],
  ])('treats %s as a missing token', async (_, authorization) => {
    const res = await send().set('Authorization', authorization);

    expectError(res, 401, 'UNAUTHORIZED');
    expect(res.get('WWW-Authenticate')).toBe(CHALLENGE);
    expect(res.get('Cache-Control')).toBe('no-store');
  });

  it('rejects a wrong token with error="invalid_token"', async () => {
    const res = await send().set(auth('not-the-configured-token'));

    expectError(res, 401, 'UNAUTHORIZED');
    expect(res.get('WWW-Authenticate')).toBe(INVALID_TOKEN_CHALLENGE);
    expect(res.get('Cache-Control')).toBe('no-store');
  });
});

describe('with the configured token', () => {
  it.each(['Bearer', 'bearer', 'BEARER'])(
    'a client using the %s scheme can call every CMS route',
    async (scheme) => {
      const authorization = `${scheme} ${TEST_TOKEN}`;

      const created = await request(app)
        .post('/api/v1/cms/posts')
        .set('Authorization', authorization)
        .send({ title: 'T', body: 'B' });
      const { id } = postOf(created);
      const responses = [
        created,
        await request(app).get('/api/v1/cms/posts').set('Authorization', authorization),
        await request(app).get(`/api/v1/cms/posts/${id}`).set('Authorization', authorization),
        await request(app)
          .post(`/api/v1/cms/posts/${id}/publish`)
          .set('Authorization', authorization),
        await request(app).delete(`/api/v1/cms/posts/${id}`).set('Authorization', authorization),
      ];

      expect(responses.map((res) => res.status)).toEqual([201, 200, 200, 200, 204]);
      for (const res of responses) {
        expect(res.get('Cache-Control')).toBe('no-store');
      }
    },
  );

  it('marks error responses as not cacheable too', async () => {
    const responses = [
      await request(app).get(`/api/v1/cms/posts/${UNKNOWN_ID}`).set(auth()),
      await request(app).get('/api/v1/cms/posts/not-an-id').set(auth()),
      await request(app).put('/api/v1/cms/posts').set(auth()),
    ];

    expect(responses.map((res) => res.status)).toEqual([404, 400, 405]);
    for (const res of responses) {
      expect(res.get('Cache-Control')).toBe('no-store');
    }
  });
});

describe('token checks', () => {
  it('reject the documented demo token when another token is configured', async () => {
    const res = await request(app).get('/api/v1/cms/posts').set(auth('wink-cms-demo-token'));

    expectError(res, 401, 'UNAUTHORIZED');
    expect(res.get('WWW-Authenticate')).toBe(INVALID_TOKEN_CHALLENGE);
  });

  it('treat the token itself as case-sensitive', async () => {
    const res = await request(app).get('/api/v1/cms/posts').set(auth(TEST_TOKEN.toUpperCase()));

    expectError(res, 401, 'UNAUTHORIZED');
    expect(res.get('WWW-Authenticate')).toBe(INVALID_TOKEN_CHALLENGE);
  });

  it('never read the token from the query string', async () => {
    const res = await request(app).get(
      `/api/v1/cms/posts?token=${TEST_TOKEN}&access_token=${TEST_TOKEN}`,
    );

    expectError(res, 401, 'UNAUTHORIZED');
    expect(res.get('WWW-Authenticate')).toBe(CHALLENGE);
  });

  it('never echo the presented token', async () => {
    const res = await request(app).get('/api/v1/cms/posts').set(auth('a-guessed-secret-12345'));

    expect(res.status).toBe(401);
    expect(res.text).not.toContain('a-guessed-secret-12345');
  });

  it('accept the documented demo token when CMS_API_TOKEN is not set', async () => {
    const demoApp = createTestApp({ CMS_API_TOKEN: undefined });

    const res = await request(demoApp).get('/api/v1/cms/posts').set(auth('wink-cms-demo-token'));

    expect(res.status).toBe(200);
  });
});

describe('the token guard runs first', () => {
  it('before the method check: PUT is 401 without a token and 405 with one', async () => {
    const anonymous = await request(app).put('/api/v1/cms/posts');
    const authenticated = await request(app).put('/api/v1/cms/posts').set(auth());

    expectError(anonymous, 401, 'UNAUTHORIZED');
    expectError(authenticated, 405, 'METHOD_NOT_ALLOWED');
  });

  it('before body parsing: malformed JSON without a token is 401', async () => {
    const res = await request(app)
      .post('/api/v1/cms/posts')
      .set('Content-Type', 'application/json')
      .send('{"title": ');

    expectError(res, 401, 'UNAUTHORIZED');
  });

  it('before validation: a malformed id without a token is 401', async () => {
    expectError(await request(app).get('/api/v1/cms/posts/not-an-id'), 401, 'UNAUTHORIZED');
  });

  it('on unknown CMS paths too: 401 without a token, 404 with one', async () => {
    const anonymous = await request(app).get('/api/v1/cms/drafts');
    const authenticated = await request(app).get('/api/v1/cms/drafts').set(auth());

    expectError(anonymous, 401, 'UNAUTHORIZED');
    expectError(authenticated, 404, 'ROUTE_NOT_FOUND');
  });
});
