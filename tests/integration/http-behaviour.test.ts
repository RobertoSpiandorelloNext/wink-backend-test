import { Script } from 'node:vm';

import request, { type Response } from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { PostModel } from '../../src/posts/post.model.js';
import { auth, createTestApp } from '../helpers/app.js';
import { useTestDatabase } from '../helpers/database.js';
import { createPublished, UNKNOWN_ID } from '../helpers/factories.js';
import { errorOf, expectError, UUID_V4 } from '../helpers/responses.js';

useTestDatabase();
const app = createTestApp();

/** The comma-separated values of a header, lower-cased. */
function headerValues(res: Response, name: string): string[] {
  return (res.get(name) ?? '').split(',').map((value) => value.trim().toLowerCase());
}

const VERBS = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'delete',
} as const;

type Verb = keyof typeof VERBS;

function call(method: Verb, path: string) {
  return request(app)[VERBS[method]](path);
}

describe('unknown routes', () => {
  it.each([
    '/api/v1/unknown',
    '/api/v2/blog/posts',
    '/api/v1/blog',
    `/api/v1/blog/posts/${UNKNOWN_ID}/comments`,
    '/favicon.ico',
  ])('GET %s answers a JSON 404 ROUTE_NOT_FOUND', async (path) => {
    const res = await request(app).get(path);

    const error = expectError(res, 404, 'ROUTE_NOT_FOUND');
    expect(error.requestId).toBe(res.get('X-Request-Id'));
  });

  it.each(['POST', 'PUT', 'DELETE'] as const)(
    '%s on an unknown path answers 404',
    async (method) => {
      expectError(await call(method, '/api/v1/unknown'), 404, 'ROUTE_NOT_FOUND');
    },
  );
});

describe('unsupported methods on known paths', () => {
  const routes: { path: string; allow: string; methods: Verb[] }[] = [
    { path: '/api/v1/blog/posts', allow: 'GET, HEAD', methods: ['POST', 'PUT', 'PATCH', 'DELETE'] },
    {
      path: `/api/v1/blog/posts/${UNKNOWN_ID}`,
      allow: 'GET, HEAD',
      methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    },
    { path: '/api/v1/cms/posts', allow: 'GET, HEAD, POST', methods: ['PUT', 'PATCH', 'DELETE'] },
    {
      path: `/api/v1/cms/posts/${UNKNOWN_ID}`,
      allow: 'GET, HEAD, DELETE',
      methods: ['POST', 'PUT', 'PATCH'],
    },
    {
      path: `/api/v1/cms/posts/${UNKNOWN_ID}/publish`,
      allow: 'POST',
      methods: ['GET', 'PUT', 'PATCH', 'DELETE'],
    },
  ];
  const cases = routes.flatMap(({ path, allow, methods }) =>
    methods.map((method) => ({ method, path, allow })),
  );

  it.each(cases)(
    '$method $path answers 405 with Allow: $allow',
    async ({ method, path, allow }) => {
      const res = await call(method, path).set(auth());

      expectError(res, 405, 'METHOD_NOT_ALLOWED');
      expect(res.get('Allow')).toBe(allow);
    },
  );
});

describe('HEAD', () => {
  it('is answered like GET, with the same headers and no body', async () => {
    await createPublished();

    const get = await request(app).get('/api/v1/blog/posts');
    const head = await request(app).head('/api/v1/blog/posts');

    expect(head.status).toBe(200);
    expect(head.get('Content-Type')).toBe(get.get('Content-Type'));
    expect(head.get('Content-Length')).toBe(get.get('Content-Length'));
    expect(head.text).toBeFalsy();
  });

  it('reports a missing post with 404', async () => {
    expect((await request(app).head(`/api/v1/blog/posts/${UNKNOWN_ID}`)).status).toBe(404);
  });

  it('requires the token on CMS routes', async () => {
    expect((await request(app).head('/api/v1/cms/posts')).status).toBe(401);
    expect((await request(app).head('/api/v1/cms/posts').set(auth())).status).toBe(200);
  });

  it('is not allowed where GET is not', async () => {
    const res = await request(app).head(`/api/v1/cms/posts/${UNKNOWN_ID}/publish`).set(auth());

    expect(res.status).toBe(405);
    expect(res.get('Allow')).toBe('POST');
  });
});

describe('request bodies (POST /api/v1/cms/posts)', () => {
  const create = () => request(app).post('/api/v1/cms/posts').set(auth());
  const validJson = JSON.stringify({ title: 'T', body: 'B' });

  it('accepts application/json with a UTF-8 charset parameter', async () => {
    const res = await create()
      .set('Content-Type', 'application/json; charset=utf-8')
      .send(validJson);

    expect(res.status).toBe(201);
  });

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'application/xml'])(
    'rejects a %s body with 415 UNSUPPORTED_MEDIA_TYPE',
    async (type) => {
      const res = await create().set('Content-Type', type).send('title=T&body=B');

      expectError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    },
  );

  it('rejects a charset other than UTF-8 with 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await create()
      .set('Content-Type', 'application/json; charset=iso-8859-1')
      .send(validJson);

    expectError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects an unsupported Content-Encoding with 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await create()
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'compress')
      .send(validJson);

    expectError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects malformed JSON with 400 INVALID_JSON, without details', async () => {
    const res = await create().set('Content-Type', 'application/json').send('{"title": "T",');

    const error = expectError(res, 400, 'INVALID_JSON');
    expect(error.details).toBeUndefined();
  });

  it.each(['"a string"', '42', 'true', 'null'])(
    'rejects the JSON primitive %s with 400 INVALID_JSON',
    async (json) => {
      const res = await create().set('Content-Type', 'application/json').send(json);

      expectError(res, 400, 'INVALID_JSON');
    },
  );

  it('rejects a body larger than 256kb with 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await create().send({ title: 'T', body: 'a'.repeat(300 * 1024) });

    expectError(res, 413, 'PAYLOAD_TOO_LARGE');
  });

  it('rejects a corrupt gzip body with 400 BAD_REQUEST, not a server error', async () => {
    const res = await create()
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .send('this is not gzip');

    expectError(res, 400, 'BAD_REQUEST');
  });
});

describe('malformed URLs', () => {
  it.each([
    ['blog', () => request(app).get('/api/v1/blog/posts/%E0%A4%A')],
    ['CMS', () => request(app).get('/api/v1/cms/posts/%ZZ').set(auth())],
  ])(
    'answer a path that cannot be percent-decoded on the %s with 400 BAD_REQUEST',
    async (_, send) => {
      const error = expectError(await send(), 400, 'BAD_REQUEST');
      expect(error.message).not.toContain('%');
    },
  );
});

describe('CORS', () => {
  it('answers a preflight to a CMS route with 204, without asking for the token', async () => {
    const res = await request(app)
      .options('/api/v1/cms/posts')
      .set('Origin', 'https://cms.example.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Authorization, Content-Type');

    expect(res.status).toBe(204);
    expect(res.get('Access-Control-Allow-Origin')).toBe('*');
    expect(headerValues(res, 'Access-Control-Allow-Methods')).toEqual(
      expect.arrayContaining(['get', 'head', 'post', 'delete']),
    );
    expect(headerValues(res, 'Access-Control-Allow-Headers')).toEqual(
      expect.arrayContaining(['authorization', 'content-type', 'x-request-id']),
    );
    expect(res.get('Access-Control-Max-Age')).toBe('600');
    expect(res.get('WWW-Authenticate')).toBeUndefined();
  });

  it('answers a preflight to delete a post', async () => {
    const res = await request(app)
      .options(`/api/v1/cms/posts/${UNKNOWN_ID}`)
      .set('Origin', 'https://cms.example.com')
      .set('Access-Control-Request-Method', 'DELETE')
      .set('Access-Control-Request-Headers', 'Authorization');

    expect(res.status).toBe(204);
    expect(headerValues(res, 'Access-Control-Allow-Methods')).toContain('delete');
  });

  it('allows any origin by default, without credentials', async () => {
    const res = await request(app)
      .get('/api/v1/blog/posts')
      .set('Origin', 'https://blog.example.com');

    expect(res.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.get('Access-Control-Allow-Credentials')).toBeUndefined();
  });

  it('exposes Location and X-Request-Id to browser clients', async () => {
    const res = await request(app)
      .post('/api/v1/cms/posts')
      .set(auth())
      .set('Origin', 'https://cms.example.com')
      .send({ title: 'T', body: 'B' });

    expect(res.status).toBe(201);
    expect(headerValues(res, 'Access-Control-Expose-Headers')).toEqual(
      expect.arrayContaining(['location', 'x-request-id']),
    );
  });

  it('allows only the configured origins when CORS_ORIGINS is a list', async () => {
    const restricted = createTestApp({
      CORS_ORIGINS: 'https://blog.example.com,https://cms.example.com',
    });

    const allowed = await request(restricted)
      .get('/api/v1/blog/posts')
      .set('Origin', 'https://cms.example.com');
    const denied = await request(restricted)
      .get('/api/v1/blog/posts')
      .set('Origin', 'https://evil.example.com');

    expect(allowed.get('Access-Control-Allow-Origin')).toBe('https://cms.example.com');
    expect(denied.get('Access-Control-Allow-Origin')).toBeUndefined();
  });
});

describe('X-Request-Id', () => {
  it('is generated for every request', async () => {
    const first = await request(app).get('/api/v1/blog/posts');
    const second = await request(app).get('/api/v1/blog/posts');

    expect(first.get('X-Request-Id')).toMatch(UUID_V4);
    expect(second.get('X-Request-Id')).toMatch(UUID_V4);
    expect(first.get('X-Request-Id')).not.toBe(second.get('X-Request-Id'));
  });

  it.each(['client-42', 'a1B2.c3_D4-e5', '8f14e45f-ceea-4e7a-9b6b-3c1f0b7a2d11', 'a'.repeat(128)])(
    'reuses the safe inbound id %s',
    async (id) => {
      const res = await request(app).get('/api/v1/blog/posts').set('X-Request-Id', id);

      expect(res.get('X-Request-Id')).toBe(id);
    },
  );

  it.each([
    ['spaces', 'my request id'],
    ['markup', '<script>alert(1)</script>'],
    ['a semicolon', 'id;drop'],
    ['more than 128 characters', 'a'.repeat(129)],
  ])('replaces an inbound id with %s by a new one', async (_, id) => {
    const res = await request(app).get('/api/v1/blog/posts').set('X-Request-Id', id);

    expect(res.get('X-Request-Id')).toMatch(UUID_V4);
  });

  it('is the requestId of error responses', async () => {
    const notFound = await request(app).get('/api/v1/unknown');
    const invalid = await request(app).get('/api/v1/blog/posts?page=0');
    const unauthorized = await request(app).get('/api/v1/cms/posts').set('X-Request-Id', 'trace-1');

    expect(errorOf(notFound).requestId).toBe(notFound.get('X-Request-Id'));
    expect(errorOf(invalid).requestId).toBe(invalid.get('X-Request-Id'));
    expect(errorOf(unauthorized).requestId).toBe('trace-1');
    expect(unauthorized.get('X-Request-Id')).toBe('trace-1');
  });
});

describe('operations endpoints', () => {
  it('GET /health reports the database as up', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('GET /api/v1/openapi.json serves the OpenAPI 3.1 document as JSON', async () => {
    const res = await request(app).get('/api/v1/openapi.json');

    expect(res.status).toBe(200);
    expect(res.type).toBe('application/json');
    expect(res.body).toMatchObject({ openapi: '3.1.0' });
  });

  it('GET /docs/ serves Swagger UI', async () => {
    const res = await request(app).get('/docs/');

    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain('swagger-ui');
  });

  it('GET /docs/swagger-ui-init.js is valid JavaScript that loads the served contract', async () => {
    const res = await request(app).get('/docs/swagger-ui-init.js').buffer(true);

    expect(res.status).toBe(200);
    // A syntax error here leaves the page blank in the browser while /docs/ still answers 200.
    expect(() => new Script(res.text)).not.toThrow();
    expect(res.text).toContain('/api/v1/openapi.json');
  });

  it('GET /docs leads to Swagger UI', async () => {
    const res = await request(app).get('/docs').redirects(1);

    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
  });

  it('GET / redirects to /docs', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(302);
    expect(res.get('Location')).toBe('/docs');
  });
});

describe('security headers', () => {
  it('do not reveal the framework and include helmet defaults', async () => {
    const res = await request(app).get('/api/v1/blog/posts');

    expect(res.get('X-Powered-By')).toBeUndefined();
    expect(res.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('do not force HTTPS upgrades, so Swagger UI also works over plain HTTP', async () => {
    const res = await request(app).get('/docs/');

    const policy = res.get('Content-Security-Policy') ?? '';
    expect(policy).not.toBe('');
    expect(policy).not.toContain('upgrade-insecure-requests');
  });
});

describe('unexpected errors', () => {
  it('answer 500 INTERNAL_ERROR without revealing internals', async () => {
    vi.spyOn(PostModel, 'find').mockImplementation(() => {
      throw new Error('Simulated failure talking to mongodb://admin:secret@db.internal');
    });

    const res = await request(app).get('/api/v1/blog/posts');

    const error = expectError(res, 500, 'INTERNAL_ERROR');
    expect(Object.keys(error).sort()).toEqual(['code', 'message', 'requestId']);
    expect(error.requestId).toBe(res.get('X-Request-Id'));
    expect(res.text).not.toMatch(/Simulated|secret|mongodb|\.ts:\d+/);
  });
});

describe('error envelope', () => {
  it('includes details only for validation errors', async () => {
    const validation = await request(app).get('/api/v1/blog/posts?page=0');
    const notFound = await request(app).get(`/api/v1/blog/posts/${UNKNOWN_ID}`);

    expect(Object.keys(errorOf(validation)).sort()).toEqual([
      'code',
      'details',
      'message',
      'requestId',
    ]);
    expect(Object.keys(errorOf(notFound)).sort()).toEqual(['code', 'message', 'requestId']);
  });
});
