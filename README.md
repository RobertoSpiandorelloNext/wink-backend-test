# WiNK Blog & CMS API

REST API behind a public blog and its content management system (CMS), written for the WiNK backend test. In short: run `docker compose up --build`, open http://localhost:3000/docs, click **Authorize** and paste `wink-cms-demo-token`.

A PDF walkthrough of what the system does and why it is built this way is available in [English](docs/technical-documentation-en.pdf) and [Italian](docs/documentazione-tecnica-it.pdf).

- **Run it:** [Quick start with Docker](#quick-start-with-docker) | [Local development](#local-development) | [CodeSandbox](#codesandbox)
- **Use it (client teams):** [Authentication](#authentication) | [API reference](#api-reference) | [A 5-minute curl tour](#a-5-minute-curl-tour)
- **Review it:** [Requirements traceability](#requirements-traceability) | [Implicit requirements and design decisions](#implicit-requirements-and-design-decisions) | [Ambiguities and how they were resolved](#ambiguities-and-how-they-were-resolved) | [Out of scope and next steps](#out-of-scope-and-next-steps) | [Architecture](#architecture) | [Testing](#testing)
- **Reference:** [npm scripts](#npm-scripts) | [Configuration](#configuration)

## Overview

One API, two clients, one MongoDB `posts` collection:

| Namespace      | Client               | Auth         | What it exposes                                                                    |
| -------------- | -------------------- | ------------ | ---------------------------------------------------------------------------------- |
| `/api/v1/blog` | Public blog frontend | none         | Published posts only, read-only: list (hashtag filter, pagination) and single post |
| `/api/v1/cms`  | CMS frontend         | Bearer token | All posts, drafts included: list, create, read, publish, delete                    |

Both namespaces return the same Post representation. Operational endpoints: `GET /health`, `GET /docs` (Swagger UI) and `GET /api/v1/openapi.json`. The contract is [`docs/openapi.yaml`](docs/openapi.yaml) (OpenAPI 3.1).

**Stack:** Node.js 22, TypeScript (strict, ES modules), Express 5, MongoDB with Mongoose 9, zod (validation), pino (logging), Vitest + supertest + mongodb-memory-server (tests).

## Quick start with Docker

Requires Docker with Compose v2. Ports 3000 and 27017 must be free.

```bash
docker compose up --build
```

- Swagger UI: http://localhost:3000/docs (`/` redirects there)
- Health check: http://localhost:3000/health

Load sample posts from a second terminal (a mix of published posts and drafts with overlapping hashtags):

```bash
docker compose exec api node dist/scripts/seed.js          # does nothing if posts already exist
docker compose exec api node dist/scripts/seed.js --reset  # deletes all posts first
```

`docker compose down` stops the stack; add `-v` to also delete the MongoDB volume. The stack is `mongo:8.2` plus the API image (multi-stage `node:22-alpine` build, runs as the non-root `node` user, with a container health check).

## Local development

Requires Node.js >= 22.13 (`.nvmrc` pins 22) and a MongoDB; the Compose file provides one.

```bash
npm install
cp .env.example .env        # optional: the defaults already target the local MongoDB
docker compose up -d mongo  # MongoDB on localhost:27017
npm run dev                 # watch mode with pretty logs, http://localhost:3000/docs
npm run seed                # sample posts; npm run seed -- --reset replaces existing posts
```

On Windows PowerShell, copy the file with `Copy-Item .env.example .env`. To use another MongoDB, set `MONGODB_URI`. To run the compiled build instead of watch mode: `npm run build && npm start`.

## CodeSandbox

The API also runs in a CodeSandbox VM Sandbox created from the GitHub repository: open `https://githubbox.com/<owner>/<repo>`, or choose "Import template" in the dashboard's import dialog and paste the repository URL. `.devcontainer/` starts Node.js 22 next to a `mongo:8.2` service, and `.codesandbox/tasks.json` installs the dependencies, starts `npm run dev` on port 3000 and loads the sample posts. No environment variable is needed: the defaults apply, including the demo CMS token. The preview opens on Swagger UI, and its "Try it out" requests go to the host serving the page.

## Authentication

The CMS API is protected by one hardcoded bearer token, as Note 1 of the brief allows:

```http
Authorization: Bearer wink-cms-demo-token
```

- Required on **every** `/api/v1/cms` request, reads included: drafts are private. The Blog API and the operational endpoints are public.
- The scheme name is case-insensitive. The token is never accepted in the query string.
- Override it with `CMS_API_TOKEN` (at least 16 characters). The server logs a warning at startup while the demo token is in use.
- Swagger UI: click **Authorize** and paste `wink-cms-demo-token` (without `Bearer `).
- Failures return 401 `UNAUTHORIZED` with `WWW-Authenticate: Bearer realm="cms"` (header missing or malformed) or `Bearer realm="cms", error="invalid_token"` (wrong token).
- The token is compared in constant time and redacted from logs.

```bash
curl -H "Authorization: Bearer wink-cms-demo-token" http://localhost:3000/api/v1/cms/posts
```

## API reference

Browse the full contract at `/docs`, or fetch it as JSON from `/api/v1/openapi.json`, for example to generate client types: `npx openapi-typescript http://localhost:3000/api/v1/openapi.json -o api.d.ts`.

### Endpoints

| Method | Path                             | Auth   | Description                                                                                                 | Success                      |
| ------ | -------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------- |
| GET    | `/api/v1/blog/posts`             | none   | Published posts, newest `publishedAt` first. Query: `hashtags`, `match`, `page`, `limit`                    | 200                          |
| GET    | `/api/v1/blog/posts/{id}`        | none   | One published post; a draft is a 404                                                                        | 200                          |
| GET    | `/api/v1/cms/posts`              | Bearer | All posts, drafts included, newest `createdAt` first. Query: `status`, `hashtags`, `match`, `page`, `limit` | 200                          |
| POST   | `/api/v1/cms/posts`              | Bearer | Create a post                                                                                               | 201 + `Location`             |
| GET    | `/api/v1/cms/posts/{id}`         | Bearer | One post in any status                                                                                      | 200                          |
| POST   | `/api/v1/cms/posts/{id}/publish` | Bearer | Publish a draft; idempotent; any request body is ignored                                                    | 200                          |
| DELETE | `/api/v1/cms/posts/{id}`         | Bearer | Delete permanently, in any status                                                                           | 204, no body                 |
| GET    | `/health`                        | none   | Liveness and database status                                                                                | 200 (503 if MongoDB is down) |
| GET    | `/api/v1/openapi.json`           | none   | The OpenAPI document as JSON                                                                                | 200                          |
| GET    | `/docs`                          | none   | Swagger UI (`GET /` redirects here)                                                                         | 200                          |

- `{id}` is the 24-character hexadecimal `id` returned by the API. A malformed id is a 400; a well-formed unknown one is a 404.
- Both lists break ties on `id` (descending), so pages are stable.
- Publishing sets `status: "published"` and `publishedAt` in one atomic step. Publishing a published post returns 200 with the post unchanged (same `publishedAt`). There is no unpublish.
- Tip for dashboards: `GET /api/v1/cms/posts?status=draft&limit=1` returns the number of drafts in `pagination.total`.

### The Post resource

Same shape on both namespaces; every key is always present:

```json
{
  "id": "674f1c2ab1c2d3e4f5a6b7c8",
  "title": "Hello Express 5",
  "body": "Plain text or Markdown, returned verbatim.",
  "hashtags": ["nodejs", "express"],
  "status": "published",
  "author": "Brian Fox",
  "publishedAt": "2026-11-14T10:00:00.000Z",
  "createdAt": "2026-11-14T09:00:00.000Z",
  "updatedAt": "2026-11-14T10:00:00.000Z"
}
```

- `status` is `draft` or `published`. `publishedAt` is `null` for drafts and is set once, when the post is first published.
- `author` is always `Brian Fox`, assigned by the server.
- `hashtags` are canonical: lower-case, without `#`, no duplicates.
- `body` is returned exactly as submitted. The API never renders or sanitizes it, so clients must escape it when rendering.
- Dates are ISO-8601 UTC strings. Treat `id` as opaque.

### Creating a post

`POST /api/v1/cms/posts` with `Content-Type: application/json`:

| Field      | Type     | Rules                                                                                                   | Default  |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------- | -------- |
| `title`    | string   | Trimmed; 1-200 characters                                                                               | required |
| `body`     | string   | 1-50,000 characters, at least one of them non-whitespace; stored verbatim (not trimmed)                 | required |
| `hashtags` | string[] | At most 10; each normalized as in the [hashtag filter](#hashtag-filter); duplicates dropped, first kept | `[]`     |
| `status`   | string   | `draft` or `published`; `published` publishes immediately and sets `publishedAt`                        | `draft`  |

```json
{
  "title": "Indexing strategies in MongoDB",
  "body": "Compound indexes follow the ESR rule: equality, sort, range.",
  "hashtags": ["#MongoDB", "mongodb", "Performance"]
}
```

This creates a draft with `"hashtags": ["mongodb", "performance"]`.

- Any other key (`author`, `publishedAt`, `id`, `createdAt`, ...) is a 400 with detail code `unknown_field`.
- A missing body is validated as `{}` (400 listing the missing fields). A body that is not `application/json` is a 415; a body over 256 kB is a 413.
- Lengths are counted in Unicode code points.
- Responds 201 with `{ "data": Post }` and `Location: /api/v1/cms/posts/{id}`. Not idempotent: every call creates a new post.

### Envelopes and pagination

- One post: `{ "data": Post }`.
- A list: `{ "data": Post[], "pagination": { "page": 1, "limit": 10, "total": 23, "totalPages": 3 } }`, where `totalPages` is `ceil(total / limit)` (0 when nothing matches). A page past the end is a 200 with `"data": []`.
- Delete: 204 with no body.

| Query parameter | Default | Allowed                     |
| --------------- | ------- | --------------------------- |
| `page`          | 1       | Integer 1-1000, digits only |
| `limit`         | 10      | Integer 1-50, digits only   |

Malformed (`abc`, `1.5`, `1e2`, empty), out-of-range or repeated (`?page=1&page=2`) values are a 400, never silently clamped. Unknown query parameters are a 400 as well.

### Hashtag filter

Available on both lists, `GET /api/v1/blog/posts` and `GET /api/v1/cms/posts`.

- **Syntax:** comma-separated (`?hashtags=nodejs,express`), repeated keys (`?hashtags=nodejs&hashtags=express`), or both (values are merged). Empty segments are ignored, so `?hashtags=` alone means no filter.
- **Matching:** `match=any` (default) returns posts with at least one of the hashtags, `match=all` only posts with all of them. `match` is ignored when no hashtags are given.
- **Normalization:** the same rule used when posts are written: trim, strip one leading `#`, Unicode NFC, lower-case. The result must be 1-50 letters, combining marks, digits or underscores (`^[\p{L}\p{M}\p{N}_]{1,50}$`), so `#NodeJS`, `nodejs` and `NODEJS` are the same tag. Duplicates are dropped.
- **Limits:** at most 10 hashtags. More, or an invalid one, is a 400 `VALIDATION_ERROR` with `location: "query"` and `field: "hashtags"`.
- **`#` in URLs:** a raw `#` starts the URL fragment and never reaches the server. Omit it, or encode it as `%23` (`?hashtags=%23nodejs`).
- **axios:** by default axios sends arrays as `hashtags[]=a&hashtags[]=b`, which is rejected as an unknown parameter. Set `paramsSerializer: { indexes: null }` to send repeated keys. `fetch` with `URLSearchParams` works as is:

```js
// axios
const { data } = await axios.get('/api/v1/blog/posts', {
  params: { hashtags: ['nodejs', 'express'], match: 'all' },
  paramsSerializer: { indexes: null }, // hashtags=nodejs&hashtags=express
});

// fetch
const params = new URLSearchParams({ match: 'all' });
for (const tag of ['nodejs', 'express']) params.append('hashtags', tag);
const response = await fetch(`/api/v1/blog/posts?${params.toString()}`);
```

### Errors

Every 4xx and 5xx response uses one envelope (the only exception is the `/health` 503 body):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "location": "body", "field": "title", "code": "required", "message": "title is required" }
    ],
    "requestId": "8f14e45f-ceea-4e7a-9b6b-3c1f0b7a2d11"
  }
}
```

- Branch on the HTTP status plus `error.code`. `message` is human-readable English and may change.
- `details` is present only for `VALIDATION_ERROR` and lists every problem at once:
  - `location`: `params`, `query` or `body`
  - `field`: dotted path (`title`, `hashtags.2`, `page`, `id`), the name of an unknown key, or `null` when the whole input is wrong (for example a body that is not a JSON object)
  - `code`: `required`, `unknown_field`, `invalid_type`, `too_small`, `too_big`, `invalid_format`, `invalid_value` or `invalid`
  - `message`: suitable for showing next to a form field
- `requestId` equals the `X-Request-Id` response header; quote it when reporting a problem.

| Status | `error.code`             | When                                                                                     | Extra headers      |
| ------ | ------------------------ | ---------------------------------------------------------------------------------------- | ------------------ |
| 400    | `VALIDATION_ERROR`       | Invalid path id, query string or body                                                    |                    |
| 400    | `INVALID_JSON`           | Malformed JSON body                                                                      |                    |
| 400    | `BAD_REQUEST`            | Unreadable request: a path that is not valid percent-encoding, a corrupt compressed body |                    |
| 401    | `UNAUTHORIZED`           | Missing, malformed or wrong bearer token (CMS only)                                      | `WWW-Authenticate` |
| 404    | `POST_NOT_FOUND`         | Unknown or deleted id, or a draft requested through the Blog API                         |                    |
| 404    | `ROUTE_NOT_FOUND`        | No such endpoint                                                                         |                    |
| 405    | `METHOD_NOT_ALLOWED`     | Known path, unsupported method                                                           | `Allow`            |
| 413    | `PAYLOAD_TOO_LARGE`      | JSON body larger than 256 kB                                                             |                    |
| 415    | `UNSUPPORTED_MEDIA_TYPE` | Body is not `application/json`, or has an unsupported charset or `Content-Encoding`      |                    |
| 500    | `INTERNAL_ERROR`         | Unexpected failure; generic message, details only in the server log                      |                    |
| 503    | `SERVICE_UNAVAILABLE`    | Database unreachable                                                                     | `Retry-After: 5`   |

### HTTP conventions

- **HEAD** is served wherever GET is.
- **405 + `Allow`** for a known path with an unsupported method: `GET, HEAD` on the Blog paths, `GET, HEAD, POST` on `/cms/posts`, `GET, HEAD, DELETE` on `/cms/posts/{id}` (so PUT and PATCH get 405), `POST` on `/cms/posts/{id}/publish`. On CMS paths the token is checked first, so a request without it gets 401.
- **404 `ROUTE_NOT_FOUND`** for any other path, as JSON.
- **CORS** is enabled for browser clients. Allowed origins come from `CORS_ORIGINS` (default `*`); methods GET, HEAD, POST and DELETE; request headers `Authorization`, `Content-Type` and `X-Request-Id`. `Location` and `X-Request-Id` are readable from JavaScript. Preflight (`OPTIONS`) requests never need the token and are cached for 10 minutes. No cookies are used.
- **`X-Request-Id`** is on every response. A valid inbound value (1-128 characters of `A-Z a-z 0-9 . _ -`) is echoed, otherwise a UUID is generated. Error bodies and server logs carry the same id.
- **`Cache-Control: no-store`** is set on every CMS response, errors included, so drafts are never cached. Blog responses do not set it.
- Security headers come from helmet; `X-Powered-By` is disabled.

## A 5-minute curl tour

Start the API (Docker or `npm run dev`), then:

```bash
BASE=http://localhost:3000/api/v1
TOKEN=wink-cms-demo-token
```

**1. Create a draft.** `status` is omitted, so it defaults to `draft`; the server sets the author.

```bash
curl -i -X POST "$BASE/cms/posts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello from the curl tour","body":"Drafts stay private until they are published.","hashtags":["#CurlTour","NodeJS","nodejs"]}'
```

The response is `201 Created` with `Location: /api/v1/cms/posts/<id>` and this body (formatted here):

```json
{
  "data": {
    "id": "6af84d40c1d2e3f4a5b6c7d8",
    "title": "Hello from the curl tour",
    "body": "Drafts stay private until they are published.",
    "hashtags": ["curltour", "nodejs"],
    "status": "draft",
    "author": "Brian Fox",
    "publishedAt": null,
    "createdAt": "2026-11-14T12:00:00.000Z",
    "updatedAt": "2026-11-14T12:00:00.000Z"
  }
}
```

The hashtags were normalized and de-duplicated. Keep the id:

```bash
ID=6af84d40c1d2e3f4a5b6c7d8   # use the id from your response
```

**2. The blog does not show it.**

```bash
curl -s "$BASE/blog/posts"       # the draft is not listed ("data": [] on an empty database)
curl -i "$BASE/blog/posts/$ID"   # 404 POST_NOT_FOUND, the same answer as for an id that never existed
```

**3. Publish it.**

```bash
curl -s -X POST "$BASE/cms/posts/$ID/publish" -H "Authorization: Bearer $TOKEN"
# 200 with "status": "published" and "publishedAt" set; run it again: 200, same publishedAt
```

**4. The blog shows it.**

```bash
curl -s "$BASE/blog/posts?limit=1"   # newest publishedAt first, so the tour post is on top
```

**5. Filter by hashtag.**

```bash
curl -s "$BASE/blog/posts?hashtags=CurlTour,nodejs&match=all"   # tagged with both; case does not matter
curl -s "$BASE/blog/posts?hashtags=curltour&hashtags=express"   # repeated keys; match=any is the default
curl -s "$BASE/blog/posts?hashtags=%23curltour"                 # a leading # must be sent as %23
```

**6. Delete it.**

```bash
curl -i -X DELETE "$BASE/cms/posts/$ID" -H "Authorization: Bearer $TOKEN"   # 204 No Content
curl -s "$BASE/blog/posts?hashtags=curltour"                               # gone: "total": 0
```

**Bonus: the guards.**

```bash
curl -i "$BASE/cms/posts"                 # 401 UNAUTHORIZED: CMS reads need the token too
curl -s "$BASE/blog/posts?status=draft"   # 400 unknown_field: drafts cannot be requested from the blog
curl -s -X POST "$BASE/cms/posts" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Hi","body":"Hello","author":"Someone Else"}'   # 400 unknown_field on "author"
```

> **Windows PowerShell:** type `curl.exe`, because `curl` is an alias of `Invoke-WebRequest`. Set the variables as `$BASE = 'http://localhost:3000/api/v1'`, `$TOKEN = 'wink-cms-demo-token'` and `$ID = '<id>'`, and end continued lines with a backtick instead of `\`. Windows PowerShell 5.1 also strips the double quotes inside JSON arguments: save the body to `post.json` and send it with `--data-binary '@post.json'` instead of `-d '...'` (PowerShell 7.3+ passes it unchanged). Git Bash and WSL run the commands as written.

## Requirements traceability

| Brief requirement                                        | How it is met                                                                                                                          | Endpoint(s)                                             | Tests                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Show list of public posts                                | Published posts only, newest first, paginated; a single published post by id                                                           | `GET /api/v1/blog/posts`, `GET /api/v1/blog/posts/{id}` | `tests/integration/blog-posts.test.ts`                                                                  |
| Create a post: title, body, list of hashtags             | Strictly validated JSON body; hashtags normalized and de-duplicated                                                                    | `POST /api/v1/cms/posts`                                | `tests/integration/cms-posts.test.ts`, `tests/unit/post-schemas.test.ts`, `tests/unit/hashtag.test.ts`  |
| Create a post: status, default draft                     | `status` is optional and defaults to `draft`; `published` publishes at creation                                                        | `POST /api/v1/cms/posts`                                | `tests/integration/cms-posts.test.ts`, `tests/unit/post-schemas.test.ts`                                |
| Create a post: author name is always Brian Fox           | Set by the server; a client-sent `author` is rejected with 400 `unknown_field`                                                         | `POST /api/v1/cms/posts`                                | `tests/integration/cms-posts.test.ts`                                                                   |
| Publish a post                                           | Atomic draft -> published; `publishedAt` set once; idempotent                                                                          | `POST /api/v1/cms/posts/{id}/publish`                   | `tests/integration/publish-delete.test.ts`                                                              |
| Delete a post                                            | Hard delete in any status; the post leaves the Blog immediately                                                                        | `DELETE /api/v1/cms/posts/{id}`                         | `tests/integration/publish-delete.test.ts`                                                              |
| Allow readers to filter posts by hashtags                | `hashtags` (comma-separated or repeated) with `match=any` (default) or `match=all`; same normalization as writes; also on the CMS list | `GET /api/v1/blog/posts?hashtags=...`                   | `tests/integration/blog-posts.test.ts`, `tests/unit/hashtag.test.ts`, `tests/unit/post-schemas.test.ts` |
| Note 1: hardcoded token, put in the documentation        | `Bearer wink-cms-demo-token` on every CMS call, documented in [Authentication](#authentication) and in the OpenAPI `bearerAuth` scheme | every `/api/v1/cms` route                               | `tests/integration/auth.test.ts`                                                                        |
| Both applications use HTTP calls; API REST specification | Resource-oriented endpoints with standard status codes and CORS; OpenAPI 3.1 contract served at `/docs`                                | all; `/api/v1/openapi.json`, `/docs`                    | `tests/integration/http-behaviour.test.ts`, `tests/contract/openapi.test.ts`                            |
| Express, MongoDB, ES6 or TypeScript                      | Express 5, MongoDB through Mongoose 9, TypeScript in strict mode (ES modules)                                                          | n/a                                                     | n/a                                                                                                     |

## Implicit requirements and design decisions

What the brief does not say but a blog and a CMS sharing one API need, and how the API handles it:

| Implicit requirement                     | Decision                                                                                                                                                                                                             | Rationale                                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drafts are never public                  | The Blog API only returns `status: "published"`. A draft id gets the same 404 `POST_NOT_FOUND` as a missing id, and `status` is not a Blog query parameter.                                                          | A different status code or message would reveal that unpublished content exists.                                                                   |
| The CMS can find what it manages         | `GET /cms/posts` lists every post (drafts included, optional `status` filter); `GET /cms/posts/{id}` returns a post in any status.                                                                                   | The brief lists publish and delete, but editors cannot act on drafts they cannot see.                                                              |
| CMS reads are protected too              | The token guard is mounted once on the whole `/api/v1/cms` router, reads included. Every CMS response carries `Cache-Control: no-store`.                                                                             | Drafts are private. One mount point means a new CMS route cannot be left unprotected, and `no-store` keeps drafts out of browser and proxy caches. |
| The author is not client input           | The server sets `author` to `Brian Fox` from one constant; a request that sends `author` gets a 400 `unknown_field`.                                                                                                 | Enforces the brief's invariant; silently ignoring the field would hide client bugs.                                                                |
| The feed is ordered by publication       | `publishedAt` is set once (at creation with `status: "published"`, or on first publish) and never changes. The Blog feed sorts by `publishedAt` descending, then `_id` descending.                                   | Sorting by `createdAt` would bury an old draft published today; the `_id` tie-break keeps pages stable when timestamps collide.                    |
| One hashtag, one spelling                | One pure function (`src/posts/hashtag.ts`) canonicalizes hashtags for writes and for filters: trim, strip one `#`, NFC, lower-case, 1-50 letters, marks, digits or underscores, de-duplicated.                       | `#NodeJS`, `nodejs` and `NODEJS` must match, or filters silently miss posts; NFC makes `caffè` the same tag however the accent was typed.          |
| Lists are bounded                        | Offset pagination: `page` 1-1000, `limit` 1-50 (default 10), with `total` and `totalPages`. Invalid values are a 400, never clamped.                                                                                 | Response size and skip cost stay bounded; clamping would return a page the client did not ask for.                                                 |
| Queries use indexes                      | Three named compound indexes match the three query shapes, sort and tie-break included: `blog_feed`, `blog_feed_by_hashtag`, `cms_list`.                                                                             | Lists stay index scans rather than collection scans as posts accumulate.                                                                           |
| Validation is strict and explains itself | zod validates path, query and body. Unknown fields and parameters are rejected, and every problem is reported at once with `location`, `field` and `code`.                                                           | Typos such as `?hashtag=` fail loudly; forms can map errors to fields; only typed primitives reach MongoDB, which rules out operator injection.    |
| One error contract                       | Every error uses `{ "error": { code, message, details?, requestId } }` with a fixed list of codes, produced by a single error middleware.                                                                            | Clients branch on status and `error.code`; stack traces and internals never leak.                                                                  |
| Malformed input never causes a 500       | An id that is not 24 hexadecimal characters is a 400 before any query runs; a well-formed unknown id is a 404. Unreadable requests (invalid percent-encoding, corrupt compressed bodies) are a 400 `BAD_REQUEST`.    | Otherwise Mongoose's `CastError` or a decoding error would surface as a 500, blaming the server for a client mistake.                              |
| Publishing is safe to retry              | A single atomic conditional update (`status: "draft"` to `published`). An already published post is returned unchanged with 200.                                                                                     | Double clicks, retries and concurrent editors cannot move `publishedAt`, and there is no read-then-write race.                                     |
| Browser clients work                     | CORS with configurable origins allows `Authorization`, exposes `Location` and `X-Request-Id`, and answers preflights before the token guard.                                                                         | Both frontends run in browsers on other origins; a preflight that required the token would always fail.                                            |
| Standard HTTP semantics                  | 201 + `Location` on create, 204 on delete, 405 + `Allow` for unsupported methods, HEAD wherever GET works, 413 and 415 for oversized or non-JSON bodies.                                                             | Generic HTTP clients, proxies and tools work without special cases.                                                                                |
| Requests are traceable, secrets are not  | `X-Request-Id` on every response (safe inbound ids are reused), repeated in error bodies and JSON logs. `Authorization` and `Cookie` are redacted; the token is compared in constant time.                           | One id links a client report to its log line; the token never appears in logs or responses.                                                        |
| The service is operable                  | `GET /health` reports database status (200 or 503). A database outage returns 503 `SERVICE_UNAVAILABLE` with `Retry-After`. SIGINT and SIGTERM stop new connections and close MongoDB, with a forced exit after 8 s. | Containers and load balancers can detect and replace a bad instance; deploys do not cut requests mid-flight.                                       |
| Configuration fails fast                 | Environment variables are validated at startup, with one message listing every invalid variable. A warning is logged while the demo token is in use.                                                                 | A bad deploy fails at boot, not on the first request.                                                                                              |
| The docs cannot drift                    | `docs/openapi.yaml` (OpenAPI 3.1) is served at `/docs`. Contract tests validate real responses against its schemas and check that documented limits equal the code constants.                                        | Client teams rely on a contract that is tested like code.                                                                                          |

## Ambiguities and how they were resolved

| Question                                 | Resolution                                                                                                 | Why                                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A blog and a CMS: one backend or two?    | One API with two namespaces, `/api/v1/blog` and `/api/v1/cms`, over one `posts` collection.                | Same data, two audiences: one deployable and one contract, with auth and caching set per namespace.              |
| What is a "public" post?                 | A post with `status: "published"`.                                                                         | Draft -> published is the brief's only lifecycle; a separate visibility flag would duplicate it.                 |
| Can a post be created already published? | Yes. `status` is accepted at creation and defaults to `draft`; `published` sets `publishedAt` at creation. | The brief lists status among the create fields and only fixes its default.                                       |
| Several hashtags: any or all?            | `match=any` (default) or `match=all`.                                                                      | Following a tag usually means "any"; "all" narrows a search. Both use the same index.                            |
| Malformed id or unknown id?              | Malformed: 400 `VALIDATION_ERROR`. Well-formed but unknown: 404 `POST_NOT_FOUND`.                          | A malformed id is a client bug; an unknown id is a normal outcome (deleted post, stale link).                    |
| Hard or soft delete?                     | Hard delete, in any status. A deleted post leaves the Blog immediately; deleting it again is a 404.        | The brief asks for delete only; soft delete adds restore and retention rules nobody asked for.                   |
| Publishing twice, unpublishing?          | Publishing is one-way and idempotent: an already published post returns 200 unchanged, not 409.            | The caller's goal (the post is published) is already met, so retries are safe. Unpublishing is not in the brief. |
| Editing posts?                           | No edit endpoint; PUT and PATCH get 405.                                                                   | Not in the brief, and doing it properly needs concurrency control (see next steps).                              |

## Out of scope and next steps

Left out on purpose to keep to the brief, each with its upgrade path:

| Not included                                          | Upgrade path                                                                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real authentication, users and roles (Note 1)         | Replace the token guard, one middleware on the CMS router, with JWT/OIDC verification against an identity provider plus role checks.                             |
| Editing posts (PATCH) and unpublishing                | `PATCH /cms/posts/{id}` reusing the create schema as a partial, guarded by `If-Match`; `POST /cms/posts/{id}/unpublish` with an explicit rule for `publishedAt`. |
| Slugs                                                 | A `slug` derived from the title with a unique index, and `GET /blog/posts/by-slug/{slug}` for readable URLs.                                                     |
| Soft delete                                           | A `deletedAt` field excluded by every query (with partial indexes), a restore endpoint and a purge job.                                                          |
| Full-text search, comments, categories, media         | A MongoDB text or Atlas Search index for search; separate resources for comments and categories; object storage with signed URLs for media.                      |
| Hashtag listing endpoint                              | `GET /blog/hashtags` with counts from an aggregation (`$unwind`, `$group`) over published posts, cached.                                                         |
| Cursor pagination                                     | Keyset pagination on (`publishedAt`, `_id`) with an opaque `nextCursor`; the current sort orders and indexes already support it.                                 |
| Rate limiting, caching layers, ETag-based concurrency | Rate limits at the gateway or in a shared-store middleware; CDN or `Cache-Control` caching for Blog reads; `ETag` and `If-Match` on future edits.                |
| Server-side Markdown rendering and sanitizing         | Bodies are returned verbatim and clients must escape them. Next: render with a Markdown library plus an HTML sanitizer and return a `bodyHtml` field.            |

## Architecture

### Layers

Requests flow router -> controller -> service -> model:

| Layer      | Files                                         | Responsibility                                                                                   |
| ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Router     | `posts/blog.router.ts`, `posts/cms.router.ts` | Paths and methods; 405 + `Allow`                                                                 |
| Controller | `posts/post.controller.ts`                    | Parse params, query and body with zod; call the service; present the result or throw `HttpError` |
| Service    | `posts/post.service.ts`                       | Business rules and queries; returns records, `null` or `false`; never imports Express            |
| Model      | `posts/post.model.ts`                         | Mongoose schema and indexes                                                                      |

- Controllers never touch the model. Only the model, the service, the database module, the health check and the seed script import Mongoose.
- "Not found" is `null` or `false` from the service; the controller turns it into an `HttpError`.
- `toPostResponse()` in `posts/post.presenter.ts` is the only place a Post response is built (`_id` becomes `id`, dates become ISO strings).
- One error middleware maps every `HttpError`, body-parser error and MongoDB connectivity error to the error envelope.

### Request pipeline

`createApp()` in `src/app.ts` registers, in order:

1. Request logger (pino-http): assigns the request id and sets `X-Request-Id`.
2. helmet security headers.
3. CORS, before any auth, so preflights never get a 401.
4. `GET /` (redirect), `/health`, `/api/v1/openapi.json` and `/docs`.
5. `/api/v1/blog` routes.
6. `/api/v1/cms`: `Cache-Control: no-store` -> token guard -> JSON body parser (256 kB) -> routes. Bodies are parsed only for authenticated requests, so a 401 wins over body errors.
7. 404 `ROUTE_NOT_FOUND`, then the error handler.

### Project structure

```text
src/
  app.ts                                createApp({ config, logger }): middleware + routers, no I/O
  server.ts                             composition root: config -> logger -> DB -> listen -> graceful shutdown
  config/env.ts                         loadConfig(): validated, frozen AppConfig
  infrastructure/database.ts            connectDatabase(), disconnectDatabase(), isDatabaseConnected()
  infrastructure/logger.ts              createLogger(): pino JSON logger
  http/http-error.ts                    HttpError, error codes, factory helpers
  http/error-handler.ts                 the single error middleware (body-parser and MongoDB error mapping)
  http/validation.ts                    parseInput(schema, value, location)
  http/pagination.ts                    page/limit rules and constants, toPagination()
  http/docs.router.ts                   OpenAPI JSON + Swagger UI
  http/middleware/request-logger.ts     pino-http + X-Request-Id
  http/middleware/require-cms-token.ts  bearer token guard (constant-time comparison)
  http/middleware/require-json.ts       415 guard for routes that accept a body
  http/middleware/no-store.ts           Cache-Control: no-store
  http/middleware/method-not-allowed.ts 405 + Allow
  http/middleware/not-found.ts          404 ROUTE_NOT_FOUND
  health/health.router.ts               GET /health
  posts/post.constants.ts               AUTHOR_NAME, statuses, length and count limits
  posts/hashtag.ts                      normalizeHashtag(), normalizeHashtags(): the one canonical form
  posts/post.model.ts                   Mongoose schema, indexes, Post model
  posts/post.schemas.ts                 zod schemas for body, query and params
  posts/post.service.ts                 business rules + persistence (no Express)
  posts/post.presenter.ts               toPostResponse(): the only Post serializer
  posts/post.controller.ts              parse input -> call service -> present, or throw HttpError
  posts/blog.router.ts                  /api/v1/blog routes
  posts/cms.router.ts                   /api/v1/cms routes
  scripts/seed.ts                       sample data
docs/
  openapi.yaml                          OpenAPI 3.1 contract, served at /docs
  technical-documentation-en.pdf        what the system does and why (English)
  documentazione-tecnica-it.pdf         the same document in Italian
tests/
  global-setup.ts                       one in-memory MongoDB per test run
  helpers/                              test database, createTestApp(), post factories
  unit/                                 pure functions and schemas
  integration/                          HTTP through supertest against a real MongoDB
  contract/                             responses and limits checked against docs/openapi.yaml
Dockerfile, docker-compose.yml          API image and local stack (API + MongoDB)
.env.example                            configuration defaults
.github/workflows/ci.yml                typecheck, lint, format check, tests, build, Docker build
```

### Why this shape

- **No repository layer.** Mongoose already is the data-access abstraction, and there is one collection behind one service. The service is the seam: it returns plain records, so changing storage touches the service and the model only.
- **`createApp()` is a pure factory.** It wires middleware and routers but opens no connection and never listens, so tests build it with an explicit config and drive it in-process with supertest. `server.ts` is the composition root: it loads the config, connects to MongoDB, builds the indexes, listens and handles signals.
- **Validation at the edge, rules in the service.** Controllers turn untrusted input into typed values; the service only receives valid data.
- **Functions over classes.** `HttpError` is the only class. Shared constants (author, statuses, limits) live in `posts/post.constants.ts` and are reused by the schemas, the model and the contract tests.
- **No async wrappers.** Express 5 forwards rejected promises from handlers to the error middleware natively.

## Testing

```bash
npm test
```

No external services are needed. `tests/global-setup.ts` starts one in-memory MongoDB (mongodb-memory-server) for the whole run, and each test file uses its own database, so files run in parallel. The first run downloads a MongoDB binary and caches it; offline, set `MONGOMS_SYSTEM_BINARY` to the path of a local `mongod`.

| Folder              | Scope                                | What it checks                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit`        | Pure functions, no database          | Hashtag normalization (case, `#`, NFC, Unicode letters, invalid characters, length, de-duplication order); request schemas (defaults, unknown fields, limits, comma-separated and repeated hashtags, page and limit bounds); configuration loading (`config.test.ts`); error mapping with real driver and Mongoose errors (`error-handler.test.ts`)                                                                                                              |
| `tests/integration` | HTTP through supertest, real MongoDB | Blog visibility, ordering and pagination; hashtag filters; the token on every CMS route; create validation (400, 413, 415); publish idempotency, concurrent calls included; delete; 404, 405, unreadable requests (400 `BAD_REQUEST`), CORS, request ids, health and docs; unexpected errors (500); token and cookie redaction in the production logger (`request-logging.test.ts`); a database outage (503, in `database-outage.test.ts`, which never connects) |
| `tests/contract`    | `docs/openapi.yaml`                  | Documented limits equal the code constants; real responses validate against the documented schemas and headers (Ajv, JSON Schema 2020-12); every documented example is reproduced; every served route is documented and vice versa                                                                                                                                                                                                                               |
| `tests/helpers`     | Shared setup                         | Per-file test database, `createTestApp()` with a known token, post factories                                                                                                                                                                                                                                                                                                                                                                                     |

Assertions use status codes, `error.code` and detail `location`, `field` and `code`, never the human-readable messages.

```bash
npm run test:coverage   # V8 coverage: text summary and HTML report in coverage/
npm run check           # typecheck + lint + format check + tests
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, format check, tests and build on the Node version from `.nvmrc`, plus a Docker image build.

## npm scripts

| Script                  | What it does                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm run dev`           | Start with `tsx watch` (restarts on change), reading `.env` if present; logs pretty-printed by pino-pretty |
| `npm run build`         | Delete `dist/`, then compile `src/` to `dist/` with source maps                                            |
| `npm start`             | Run the compiled server (`dist/server.js`), reading `.env` if present                                      |
| `npm run seed`          | Insert sample posts; skipped when posts exist; `npm run seed -- --reset` replaces them                     |
| `npm run typecheck`     | Type-check sources, tests and config files (`tsc --noEmit`)                                                |
| `npm run lint`          | ESLint with the strict and stylistic type-checked typescript-eslint presets                                |
| `npm run lint:fix`      | ESLint with automatic fixes                                                                                |
| `npm run format`        | Format every file with Prettier                                                                            |
| `npm run format:check`  | Check formatting without writing                                                                           |
| `npm test`              | Run all tests once (Vitest)                                                                                |
| `npm run test:watch`    | Vitest in watch mode                                                                                       |
| `npm run test:coverage` | Tests with V8 coverage: text summary and HTML report in `coverage/`                                        |
| `npm run check`         | `typecheck`, `lint`, `format:check` and `test`, in that order                                              |

## Configuration

| Variable        | Default                               | Rule                                                                                                     |
| --------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`      | `development`                         | `development`, `test` or `production`                                                                    |
| `PORT`          | `3000`                                | Integer 1-65535                                                                                          |
| `MONGODB_URI`   | `mongodb://127.0.0.1:27017/wink-blog` | Starts with `mongodb://` or `mongodb+srv://`                                                             |
| `CMS_API_TOKEN` | `wink-cms-demo-token`                 | At least 16 characters; the bearer token the CMS API expects                                             |
| `CORS_ORIGINS`  | `*`                                   | `*`, or a comma-separated list of allowed origins (e.g. `http://localhost:5173,https://cms.example.com`) |
| `LOG_LEVEL`     | `info`                                | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`                                           |

- `.env.example` lists these defaults. `npm run dev`, `npm start` and `npm run seed` read `.env` when it exists.
- Invalid values stop the process at startup with one message that lists every invalid variable.
- Under Docker Compose, the `api` service takes its environment from `docker-compose.yml`, which points `MONGODB_URI` at the `mongo` service.
- Outside local development, set `CMS_API_TOKEN` to a long random value.
