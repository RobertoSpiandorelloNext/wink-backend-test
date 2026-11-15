import { randomUUID } from 'node:crypto';

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import ajvFormats from 'ajv-formats';
import mongoose from 'mongoose';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { DEFAULT_CMS_API_TOKEN, loadConfig } from '../../src/config/env.js';
import { loadOpenApiDocument } from '../../src/http/docs.router.js';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
} from '../../src/http/pagination.js';
import { HASHTAG_PATTERN } from '../../src/posts/hashtag.js';
import {
  AUTHOR_NAME,
  BODY_MAX_LENGTH,
  DEFAULT_HASHTAG_MATCH,
  DEFAULT_POST_STATUS,
  HASHTAG_MATCH_MODES,
  HASHTAG_MAX_LENGTH,
  HASHTAGS_MAX_ITEMS,
  POST_STATUSES,
  TITLE_MAX_LENGTH,
} from '../../src/posts/post.constants.js';
import { PostModel } from '../../src/posts/post.model.js';
import { blogListQuery, cmsListQuery, createPostBody } from '../../src/posts/post.schemas.js';

// docs/openapi.yaml must describe the API exactly as it behaves. It is checked on its own
// (references, schemas, examples), against the code's constants and request parsers, against real
// responses (validated with Ajv), and against the routes the app registers. Human-readable
// messages are never asserted: they are not part of the contract.

type JsonObject = Readonly<Record<string, unknown>>;

/** An object of the document, and the JSON pointer (as a URI fragment) where it lives. */
interface Located {
  readonly fragment: string;
  readonly node: JsonObject;
}

const VERBS = ['get', 'head', 'post', 'put', 'patch', 'delete'] as const;
type Verb = (typeof VERBS)[number];

const BLOG_POSTS = '/api/v1/blog/posts';
const CMS_POSTS = '/api/v1/cms/posts';
const AUTH = { Authorization: `Bearer ${DEFAULT_CMS_API_TOKEN}` };
/** Well-formed, but no post has it. */
const UNKNOWN_ID = '0'.repeat(24);

const document = loadOpenApiDocument();
const app = createApp({
  // The documented demo token, so these tests also prove that the documented token works.
  config: loadConfig({ NODE_ENV: 'test', CMS_API_TOKEN: DEFAULT_CMS_API_TOKEN }),
  logger: pino({ level: 'silent' }),
});
const api = request(app);

beforeAll(async () => {
  await mongoose.connect(inject('mongoUri'), { dbName: `contract_${randomUUID()}` });
  await PostModel.init();
});

afterEach(async () => {
  await PostModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ---- Reading the document ----

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Appends keys to a JSON pointer written as a URI fragment: `pointer('#', 'paths', '/health')`. */
function pointer(base: string, ...keys: string[]): string {
  const escape = (key: string) =>
    encodeURIComponent(key.replaceAll('~', '~0').replaceAll('/', '~1'));
  return base + keys.map((key) => `/${escape(key)}`).join('');
}

/** The value at a `#/...` pointer, if the document has one. */
function valueAt(fragment: string): unknown {
  return fragment
    .split('/')
    .slice(1)
    .map((key) => decodeURIComponent(key).replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>(
      (node, key) =>
        typeof node === 'object' && node !== null ? (node as JsonObject)[key] : undefined,
      document,
    );
}

/** The object at a pointer, following `$ref`s; throws when the document has none. */
function resolve(fragment: string): Located {
  const node = valueAt(fragment);
  if (!isRecord(node)) {
    throw new Error(`docs/openapi.yaml has no object at ${fragment}`);
  }
  return typeof node.$ref === 'string' ? resolve(node.$ref) : { fragment, node };
}

function keysAt(fragment: string): string[] {
  const value = valueAt(fragment);
  return isRecord(value) ? Object.keys(value) : [];
}

/** Every object of the document, depth first. */
function* objects(node: unknown = document, fragment = '#'): Generator<Located> {
  if (typeof node !== 'object' || node === null) {
    return;
  }
  if (isRecord(node)) {
    yield { fragment, node };
  }
  for (const [key, child] of Object.entries(node)) {
    yield* objects(child, pointer(fragment, key));
  }
}

const DOCUMENT_ID = 'openapi.json';
const ajv = new Ajv2020({ allErrors: true });
ajvFormats.default(ajv);
// The OpenAPI fields at the root (openapi, info, paths, components...) are not JSON Schema
// keywords. Declaring them lets Ajv load the whole document as one schema, so that `$ref`s such as
// `#/components/schemas/Post` resolve exactly as written.
ajv.addVocabulary(Object.keys(document));
ajv.addSchema(document, DOCUMENT_ID);
const validators = new Map<string, ValidateFunction>();

/** Ajv's errors for `value` against the schema at `fragment` (empty when it is valid). */
function schemaErrors(fragment: string, value: unknown): string {
  let validate = validators.get(fragment);
  if (validate === undefined) {
    validate = ajv.compile({ $ref: DOCUMENT_ID + fragment });
    validators.set(fragment, validate);
  }
  return validate(value) ? '' : ajv.errorsText(validate.errors);
}

const paths = keysAt('#/paths');

/** A concrete URL for a documented path: `{id}` becomes an id no post has. */
function sampleUrl(path: string): string {
  return path.replace(/\{[^}]+\}/g, UNKNOWN_ID);
}

/** Matches the concrete URLs of a documented path (a path parameter is one segment). */
function pathPattern(path: string): RegExp {
  const literal = path.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  return new RegExp(`^${literal.replace(/\{[^}]+\}/g, '[^/]+')}$`);
}

function documentedVerbs(path: string): Verb[] {
  return VERBS.filter((verb) => isRecord(valueAt(pointer('#', 'paths', path, verb))));
}

/** The methods a path answers: the documented ones, plus HEAD wherever GET is (as Express does). */
function servedVerbs(path: string): Verb[] {
  const verbs = documentedVerbs(path);
  return verbs.includes('get') && !verbs.includes('head') ? [...verbs, 'head'] : verbs;
}

function operation(path: string, verb: Verb): JsonObject {
  return resolve(pointer('#', 'paths', path, verb)).node;
}

function requiresToken(path: string, verb: Verb): boolean {
  const { security } = operation(path, verb);
  return (
    Array.isArray(security) &&
    security.some((requirement: unknown) => isRecord(requirement) && 'bearerAuth' in requirement)
  );
}

function responsesOf(path: string, verb: Verb): { status: string; response: Located }[] {
  const responses = pointer('#', 'paths', path, verb, 'responses');
  return keysAt(responses).map((status) => ({
    status,
    response: resolve(pointer(responses, status)),
  }));
}

/** The response a path documents for a status, on whichever of its operations lists it. */
function pathResponse(path: string, status: string): Located {
  const verb = documentedVerbs(path).find((candidate) =>
    keysAt(pointer('#', 'paths', path, candidate, 'responses')).includes(status),
  );
  if (verb === undefined) {
    throw new Error(`${path} documents no ${status} response`);
  }
  return resolve(pointer('#', 'paths', path, verb, 'responses', status));
}

const operations = paths.flatMap((path) =>
  documentedVerbs(path).map((verb) => ({ method: verb.toUpperCase(), path, verb })),
);

// ---- Checking real responses ----

/** The documented response that must describe a real one. */
function documentedFor(res: request.Response): Located {
  const { pathname } = new URL(res.request.url);
  const status = String(res.status);
  const path = paths.find((candidate) => pathPattern(candidate).test(pathname));
  if (path === undefined) {
    expect(status, `${pathname} is not a documented path`).toBe('404');
    return resolve('#/components/responses/RouteNotFound');
  }
  // Express answers HEAD with the GET handler.
  const verb = res.request.method === 'HEAD' ? 'get' : res.request.method.toLowerCase();
  const responses = pointer('#', 'paths', path, verb, 'responses');
  if (isRecord(valueAt(responses))) {
    expect(keysAt(responses), `${res.request.method} ${path}`).toContain(status);
    return resolve(pointer(responses, status));
  }
  // A method the path does not document may only be refused: by the token guard, or with 405.
  expect(['401', '405'], `${res.request.method} ${path}`).toContain(status);
  return pathResponse(path, status);
}

/**
 * Asserts that a real response is the documented one: required headers present and every
 * documented header valid, the documented media type and body schema, and `Cache-Control:
 * no-store` on every CMS response (errors included) and on no other.
 */
function expectToMatch(res: request.Response, documented: Located): void {
  const isCms = /^\/api\/v1\/cms(\/|$)/.test(new URL(res.request.url).pathname);
  expect(res.headers['cache-control'], 'Cache-Control').toBe(isCms ? 'no-store' : undefined);

  for (const name of keysAt(pointer(documented.fragment, 'headers'))) {
    const header = resolve(pointer(documented.fragment, 'headers', name));
    const value = res.headers[name.toLowerCase()];
    if (value === undefined) {
      expect(header.node.required, `${name} header`).not.toBe(true);
      continue;
    }
    const schema = pointer(header.fragment, 'schema');
    const typed = resolve(schema).node.type === 'integer' ? Number(value) : value;
    expect(schemaErrors(schema, typed), `${name} header`).toBe('');
  }

  const mediaTypes = keysAt(pointer(documented.fragment, 'content'));
  if (res.request.method === 'HEAD' || mediaTypes.length === 0) {
    return;
  }
  expect(mediaTypes).toContain(res.type);
  const body: unknown = res.type === 'application/json' ? res.body : res.text;
  expect(schemaErrors(pointer(documented.fragment, 'content', res.type, 'schema'), body)).toBe('');
  if (isRecord(body) && isRecord(body.error)) {
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  }
}

/** Asserts the status, then that the response is the one documented for it. */
function expectDocumented(res: request.Response, status: number): void {
  expect(res.status, res.text).toBe(status);
  expectToMatch(res, documentedFor(res));
}

/** What clients branch on in an error body: its code, and each detail's location, field and code. */
function errorContract(body: unknown): unknown {
  if (!isRecord(body) || !isRecord(body.error)) {
    return body;
  }
  const { code, details } = body.error;
  return {
    code,
    details: Array.isArray(details)
      ? details.map((detail: unknown) =>
          isRecord(detail)
            ? { location: detail.location, field: detail.field, code: detail.code }
            : detail,
        )
      : details,
  };
}

function isRouteNotFound(res: request.Response): boolean {
  const contract = errorContract(res.body);
  return res.status === 404 && isRecord(contract) && contract.code === 'ROUTE_NOT_FOUND';
}

/** What a created post shows of the request that created it: all but its id and timestamps. */
function authoredFields(envelope: unknown): unknown {
  const post: JsonObject = isRecord(envelope) && isRecord(envelope.data) ? envelope.data : {};
  const { title, body, hashtags, status, author, publishedAt } = post;
  return { title, body, hashtags, status, author, isPublished: publishedAt !== null };
}

function idOf(res: request.Response): string {
  const body: unknown = res.body;
  if (isRecord(body) && isRecord(body.data) && typeof body.data.id === 'string') {
    return body.data.id;
  }
  throw new Error(`No post in the response: ${res.text}`);
}

function createPost(body: object | string): request.Test {
  return api.post(CMS_POSTS).set(AUTH).send(body);
}

/**
 * The status and the request behind each documented error example (`Response/example`), so that
 * every example shows what the API really answers.
 */
const ERROR_EXAMPLES: Record<string, [status: number, send: () => request.Test]> = {
  'InvalidPostId/malformedId': [400, () => api.get(`${BLOG_POSTS}/not-an-id`)],
  'InvalidQuery/unknownParameter': [400, () => api.get(`${BLOG_POSTS}?sort=title`)],
  'InvalidQuery/invalidHashtag': [400, () => api.get(`${BLOG_POSTS}?hashtags=node-js`)],
  'InvalidQuery/tooManyHashtags': [
    400,
    () => api.get(`${BLOG_POSTS}?hashtags=a,b,c,d,e,f,g,h,i,j,k`),
  ],
  'InvalidQuery/pageOutOfRange': [400, () => api.get(`${CMS_POSTS}?page=0`).set(AUTH)],
  'InvalidBody/missingFields': [400, () => createPost({})],
  'InvalidBody/unknownField': [400, () => createPost({ title: 'Hi', body: 'You', author: 'Me' })],
  'InvalidBody/invalidValues': [
    400,
    () =>
      createPost({ title: 'x'.repeat(TITLE_MAX_LENGTH + 1), body: ' \n', hashtags: ['ok', 'no-'] }),
  ],
  'InvalidBody/notAnObject': [400, () => createPost([])],
  'InvalidBody/malformedJson': [400, () => createPost('{"title": ').type('json')],
  'Unauthorized/missingToken': [401, () => api.get(CMS_POSTS)],
  'Unauthorized/wrongToken': [401, () => api.get(CMS_POSTS).set('Authorization', 'Bearer nope')],
  'PostNotFound/notFound': [404, () => api.get(`${CMS_POSTS}/${UNKNOWN_ID}`).set(AUTH)],
  'RouteNotFound/notFound': [404, () => api.get('/api/v1/posts')],
  'MethodNotAllowed/methodNotAllowed': [405, () => api.put(BLOG_POSTS)],
  'PayloadTooLarge/tooLarge': [413, () => createPost({ title: 'Big', body: 'x'.repeat(300_000) })],
  'UnsupportedMediaType/notJson': [415, () => createPost('Hello').type('text/plain')],
};

// ---- Listing what the app serves ----

/** The part of Express 5's router internals needed to list what an app serves. */
interface RouterLayer {
  readonly name: string;
  /** True for middleware mounted without a path, which runs for every request. */
  readonly slash: boolean;
  /** The part of the path the last `match()` call matched. */
  readonly path: string | undefined;
  readonly route?: { readonly path: string; readonly methods: Readonly<Record<string, boolean>> };
  readonly handle: { readonly stack?: readonly RouterLayer[] };
  match(path: string): boolean;
}

interface ServedRoute {
  readonly label: string;
  readonly verbs: readonly string[];
  /** Whether a request for this URL gets to the route, through the routers it is mounted on. */
  readonly reaches: (url: string) => boolean;
}

/**
 * Every route, and every middleware mounted on a path (Swagger UI), of an Express 5 router tree.
 * Express does not keep the paths routers are mounted on, so instead of a full path each entry
 * tells whether a URL reaches it, through the same matchers Express routes requests with.
 */
function servedRoutes(
  stack: readonly RouterLayer[],
  remaining: (url: string) => string | undefined = (url) => url,
): ServedRoute[] {
  return stack.flatMap((layer): ServedRoute[] => {
    // What is left of the URL for the next layers once this one has matched and stripped its part.
    const rest = (url: string): string | undefined => {
      const path = remaining(url);
      return path !== undefined && layer.match(path)
        ? path.slice(layer.path?.length ?? 0) || '/'
        : undefined;
    };
    const reaches = (url: string): boolean => rest(url) !== undefined;
    if (layer.route !== undefined) {
      // `_all` is the handler that ends every route with a 405.
      const verbs = Object.keys(layer.route.methods).filter((method) => method !== '_all');
      return [{ label: `${verbs.join(',')} ${layer.route.path}`, verbs, reaches }];
    }
    if (layer.handle.stack !== undefined) {
      return servedRoutes(layer.handle.stack, rest);
    }
    return layer.slash ? [] : [{ label: `${layer.name} middleware`, verbs: [], reaches }];
  });
}

describe('docs/openapi.yaml', () => {
  describe('as a document', () => {
    it('is served as JSON at /api/v1/openapi.json and declares OpenAPI 3.1.0', async () => {
      const res = await api.get('/api/v1/openapi.json');

      expectDocumented(res, 200);
      expect(res.body).toStrictEqual(document);
      expect(document.openapi).toBe('3.1.0');
    });

    it('has no dangling $ref', () => {
      const dangling = [...objects()]
        .filter(({ node }) => typeof node.$ref === 'string' && valueAt(node.$ref) === undefined)
        .map(({ fragment }) => fragment);

      expect(dangling).toEqual([]);
    });

    it('has schemas that compile as strict JSON Schema 2020-12', () => {
      const schemas = [
        ...keysAt('#/components/schemas').map((name) =>
          pointer('#', 'components', 'schemas', name),
        ),
        // Parameters, headers and media types carry their schema under `schema`.
        ...[...objects()]
          .filter(({ node }) => isRecord(node.schema))
          .map(({ fragment }) => pointer(fragment, 'schema')),
      ];

      for (const schema of schemas) {
        expect(() => schemaErrors(schema, null), schema).not.toThrow();
      }
    });

    it('has examples that are valid against their schemas', () => {
      const invalid: string[] = [];
      const check = (schema: string, example: unknown, at: string): void => {
        const errors = schemaErrors(schema, example);
        if (errors !== '') {
          invalid.push(`${at}: ${errors}`);
        }
      };

      for (const { fragment, node } of objects()) {
        if (Array.isArray(node.examples)) {
          // JSON Schema `examples` (an array) belong to the schema they sit in.
          node.examples.forEach((example: unknown, index: number) => {
            check(fragment, example, pointer(fragment, 'examples', String(index)));
          });
        } else if (isRecord(node.schema)) {
          // Parameter and media type examples sit next to their `schema`.
          const schema = pointer(fragment, 'schema');
          if ('example' in node) {
            check(schema, node.example, pointer(fragment, 'example'));
          }
          for (const name of keysAt(pointer(fragment, 'examples'))) {
            const example = pointer(fragment, 'examples', name);
            check(schema, resolve(example).node.value, example);
          }
        }
      }

      expect(invalid).toEqual([]);
    });

    it('uses the error envelope for every 4xx and 5xx response, but the health check 503', () => {
      const others = operations.flatMap(({ method, path, verb }) =>
        responsesOf(path, verb)
          .filter(
            ({ status }) => Number(status) >= 400 && !(path === '/health' && status === '503'),
          )
          .filter(
            ({ response }) =>
              valueAt(
                pointer(response.fragment, 'content', 'application/json', 'schema', '$ref'),
              ) !== '#/components/schemas/ErrorEnvelope',
          )
          .map(({ status }) => `${method} ${path} ${status}`),
      );

      expect(others).toEqual([]);
    });

    it('advertises Cache-Control on every CMS success response, and on no Blog or Ops response', () => {
      const wrong = operations.flatMap(({ method, path, verb }) =>
        responsesOf(path, verb)
          .filter(({ status, response }) => {
            const advertised = keysAt(pointer(response.fragment, 'headers')).includes(
              'Cache-Control',
            );
            return path.startsWith('/api/v1/cms/')
              ? status.startsWith('2') && !advertised
              : advertised;
          })
          .map(({ status }) => `${method} ${path} ${status}`),
      );

      expect(wrong).toEqual([]);
    });

    it('documents body errors (INVALID_JSON, 413, 415) only for operations that take a body', () => {
      const documentsBodyErrors = (path: string, verb: Verb): boolean =>
        responsesOf(path, verb).some(({ status, response }) => {
          // The operation's own entry may override the description of the response it references.
          const own = valueAt(pointer('#', 'paths', path, verb, 'responses', status));
          return (
            status === '413' ||
            status === '415' ||
            JSON.stringify([own, response.node]).includes('INVALID_JSON')
          );
        });
      const wrong = operations
        .filter(
          ({ path, verb }) =>
            isRecord(operation(path, verb).requestBody) !== documentsBodyErrors(path, verb),
        )
        .map(({ method, path }) => `${method} ${path}`);

      expect(wrong).toEqual([]);
    });
  });

  describe('matches the code', () => {
    const constants: [fragment: string, expected: unknown][] = [
      ['#/components/schemas/Post/properties/title/maxLength', TITLE_MAX_LENGTH],
      ['#/components/schemas/CreatePostRequest/properties/title/maxLength', TITLE_MAX_LENGTH],
      ['#/components/schemas/Post/properties/body/maxLength', BODY_MAX_LENGTH],
      ['#/components/schemas/CreatePostRequest/properties/body/maxLength', BODY_MAX_LENGTH],
      ['#/components/schemas/Post/properties/hashtags/items/maxLength', HASHTAG_MAX_LENGTH],
      ['#/components/schemas/Post/properties/hashtags/items/pattern', HASHTAG_PATTERN.source],
      ['#/components/schemas/Post/properties/hashtags/maxItems', HASHTAGS_MAX_ITEMS],
      ['#/components/schemas/CreatePostRequest/properties/hashtags/maxItems', HASHTAGS_MAX_ITEMS],
      ['#/components/parameters/Hashtags/schema/maxItems', HASHTAGS_MAX_ITEMS],
      ['#/components/schemas/Post/properties/status/enum', POST_STATUSES],
      ['#/components/schemas/CreatePostRequest/properties/status/enum', POST_STATUSES],
      ['#/components/schemas/CreatePostRequest/properties/status/default', DEFAULT_POST_STATUS],
      ['#/components/parameters/Status/schema/enum', POST_STATUSES],
      ['#/components/parameters/Match/schema/enum', HASHTAG_MATCH_MODES],
      ['#/components/parameters/Match/schema/default', DEFAULT_HASHTAG_MATCH],
      ['#/components/parameters/Page/schema/maximum', MAX_PAGE],
      ['#/components/parameters/Page/schema/default', DEFAULT_PAGE],
      ['#/components/parameters/Limit/schema/maximum', MAX_PAGE_SIZE],
      ['#/components/parameters/Limit/schema/default', DEFAULT_PAGE_SIZE],
      ['#/components/schemas/Pagination/properties/page/maximum', MAX_PAGE],
      ['#/components/schemas/Pagination/properties/limit/maximum', MAX_PAGE_SIZE],
      ['#/components/schemas/PostListEnvelope/properties/data/maxItems', MAX_PAGE_SIZE],
      ['#/components/schemas/Post/properties/author/const', AUTHOR_NAME],
    ];

    it.each(constants)('%s is %j', (fragment, expected) => {
      expect(valueAt(fragment)).toStrictEqual(expected);
    });

    it('quotes the demo token and the hashtag rule as the code defines them', () => {
      expect(valueAt('#/info/description')).toContain(
        `Authorization: Bearer ${DEFAULT_CMS_API_TOKEN}`,
      );
      expect(valueAt('#/components/securitySchemes/bearerAuth/description')).toContain(
        DEFAULT_CMS_API_TOKEN,
      );
      expect(valueAt('#/components/parameters/Hashtags/description')).toContain(
        HASHTAG_PATTERN.source,
      );
      expect(
        valueAt('#/components/schemas/CreatePostRequest/properties/hashtags/description'),
      ).toContain(HASHTAG_PATTERN.source);
    });

    it('names exactly the query parameters and body fields the request parsers accept', () => {
      const queryParameters = (path: string): string[] => {
        const list = pointer('#', 'paths', path, 'get', 'parameters');
        const parameters = valueAt(list);
        return (Array.isArray(parameters) ? parameters : [])
          .map((_: unknown, index: number) => resolve(pointer(list, String(index))).node)
          .filter((parameter) => parameter.in === 'query')
          .map((parameter) => String(parameter.name))
          .toSorted();
      };
      const requiredFields = Object.entries(createPostBody.shape)
        .filter(([, field]) => !field.safeParse(undefined).success)
        .map(([name]) => name);

      expect(queryParameters(BLOG_POSTS)).toEqual(Object.keys(blogListQuery.shape).toSorted());
      expect(queryParameters(CMS_POSTS)).toEqual(Object.keys(cmsListQuery.shape).toSorted());
      expect(keysAt('#/components/schemas/CreatePostRequest/properties').toSorted()).toEqual(
        Object.keys(createPostBody.shape).toSorted(),
      );
      expect(valueAt('#/components/schemas/CreatePostRequest/required')).toEqual(requiredFields);
    });
  });

  describe('describes the real responses', () => {
    it('of a post going through its whole lifecycle', async () => {
      const created = await createPost({
        title: 'Contract',
        body: 'Checked against docs/openapi.yaml.',
        hashtags: ['#Contract'],
      });
      expectDocumented(created, 201);
      const id = idOf(created);
      expect(created.headers.location).toBe(`${CMS_POSTS}/${id}`);

      expectDocumented(await api.get(`${CMS_POSTS}/${id}`).set(AUTH), 200);
      expectDocumented(await api.get(`${CMS_POSTS}?status=draft&hashtags=contract`).set(AUTH), 200);
      expectDocumented(await api.post(`${CMS_POSTS}/${id}/publish`).set(AUTH), 200);
      expectDocumented(await api.get(`${BLOG_POSTS}/${id}`), 200);
      expectDocumented(await api.delete(`${CMS_POSTS}/${id}`).set(AUTH), 204);
    });

    it('of a page of the blog feed', async () => {
      for (const title of ['First', 'Second']) {
        const post = {
          title,
          body: 'Published at once.',
          hashtags: ['paged'],
          status: 'published',
        };
        expectDocumented(await createPost(post), 201);
      }

      const res = await api.get(`${BLOG_POSTS}?hashtags=paged&page=2&limit=1`);

      expectDocumented(res, 200);
      expect(res.body).toHaveProperty('data.length', 1);
      expect(res.body).toHaveProperty('pagination', { page: 2, limit: 1, total: 2, totalPages: 2 });
    });

    it('of the health check', async () => {
      expectDocumented(await api.get('/health'), 200);
    });

    /** Where the create operation keeps the JSON examples of its request body or a response. */
    const createExamples = (...part: string[]): string =>
      pointer('#', 'paths', CMS_POSTS, 'post', ...part, 'content', 'application/json', 'examples');

    it.each(keysAt(createExamples('requestBody')))(
      'of the "%s" create request example: its 201 example',
      async (name) => {
        const sent = resolve(pointer(createExamples('requestBody'), name)).node.value;
        if (!isRecord(sent)) {
          throw new Error(`The "${name}" request example is not an object`);
        }

        const res = await createPost(sent);

        expectDocumented(res, 201);
        const shown = resolve(pointer(createExamples('responses', '201'), name)).node.value;
        expect(authoredFields(res.body)).toEqual(authoredFields(shown));
      },
    );

    it.each(Object.entries(ERROR_EXAMPLES))('of the %s example', async (key, [status, send]) => {
      const [name, example] = key.split('/') as [string, string];

      const res = await send();

      expectDocumented(res, status);
      const documented = documentedFor(res);
      expect(documented.fragment).toBe(pointer('#', 'components', 'responses', name));
      const examples = pointer(documented.fragment, 'content', 'application/json', 'examples');
      const shown = resolve(pointer(examples, example)).node.value;
      expect(errorContract(res.body)).toEqual(errorContract(shown));
    });

    it('of every error example a client can trigger', () => {
      const examples = keysAt('#/components/responses').flatMap((name) =>
        keysAt(
          pointer('#', 'components', 'responses', name, 'content', 'application/json', 'examples'),
        ).map((example) => `${name}/${example}`),
      );
      // A 500 or a 503 cannot be caused from outside: those examples are only schema-checked.
      const triggerable = examples.filter(
        (key) => !/^(InternalError|ServiceUnavailable)\//.test(key),
      );

      expect(Object.keys(ERROR_EXAMPLES).toSorted()).toEqual(triggerable.toSorted());
    });
  });

  describe('documents exactly the routes the app serves', () => {
    it.each(operations)(
      'answers $method $path with a documented response',
      async ({ path, verb }) => {
        const url = sampleUrl(path);
        const auth = requiresToken(path, verb) ? AUTH : {};

        const res = await api[verb](url).set(auth);

        expect(isRouteNotFound(res)).toBe(false);
        expect(res.status).not.toBe(405);
        expectDocumented(res, res.status);
        if (!isRecord(operation(path, verb).requestBody)) {
          // An operation that takes no body ignores one, even a malformed one.
          const withBody = await api[verb](url).set(auth).type('json').send('{"not": json');
          expect(withBody.status).toBe(res.status);
        }
        if (verb === 'get') {
          expectDocumented(await api.head(url).set(auth), res.status);
        }
      },
    );

    const refusals = paths
      .filter((path) =>
        documentedVerbs(path).some((verb) =>
          keysAt(pointer('#', 'paths', path, verb, 'responses')).includes('405'),
        ),
      )
      .flatMap((path) =>
        VERBS.filter((verb) => !servedVerbs(path).includes(verb)).map((verb) => ({
          method: verb.toUpperCase(),
          path,
          verb,
        })),
      );

    it.each(refusals)(
      'refuses $method $path with 405 and the documented Allow',
      async ({ path, verb }) => {
        const url = sampleUrl(path);
        const isProtected = documentedVerbs(path).some((documented) =>
          requiresToken(path, documented),
        );
        if (isProtected) {
          // The token is checked before the method.
          expectDocumented(await api[verb](url), 401);
        }

        const res = await api[verb](url).set(isProtected ? AUTH : {});

        expectDocumented(res, 405);
        expect(res.headers.allow?.split(', ').toSorted()).toEqual(
          servedVerbs(path)
            .map((served) => served.toUpperCase())
            .toSorted(),
        );
      },
    );

    it('serves no route that is not documented', () => {
      // Express 5 keeps the layers a request goes through in app.router.stack.
      const stack = app.router.stack as unknown as readonly RouterLayer[];
      const undocumented = servedRoutes(stack).filter(
        (route) =>
          !paths.some((path) => {
            const documented: readonly string[] = documentedVerbs(path);
            return (
              route.reaches(sampleUrl(path)) &&
              route.verbs.every((verb) => documented.includes(verb))
            );
          }),
      );

      expect(undocumented.map((route) => route.label)).toEqual([]);
    });
  });
});
