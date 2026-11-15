import type { Response } from 'supertest';
import { expect } from 'vitest';

// Response bodies as the API documents them (a post, the list and error envelopes). Tests read
// bodies through these accessors so that every assertion on them is type-checked.

export interface PostJson {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly hashtags: readonly string[];
  readonly status: 'draft' | 'published';
  readonly author: string;
  readonly publishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PaginationJson {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface PostListJson {
  readonly data: readonly PostJson[];
  readonly pagination: PaginationJson;
}

/** A validation problem, without its human-readable message (not part of the contract). */
export interface Issue {
  readonly location: 'params' | 'query' | 'body';
  readonly field: string | null;
  readonly code: string;
}

export interface ErrorJson {
  readonly code: string;
  readonly message: string;
  readonly details?: readonly (Issue & { readonly message: string })[];
  readonly requestId: string;
}

/** An ISO-8601 UTC timestamp with milliseconds, as produced by `Date#toISOString()`. */
export const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A 24-character, lower-case hexadecimal ObjectId. */
export const OBJECT_ID = /^[0-9a-f]{24}$/;

/** A version 4 UUID, as returned by `crypto.randomUUID()`. */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function member(res: Response, key: string): unknown {
  const body: unknown = res.body;
  if (typeof body !== 'object' || body === null || !(key in body)) {
    throw new Error(`Expected "${key}" in the response body, got ${res.status}: ${res.text}`);
  }
  return (body as Record<string, unknown>)[key];
}

/** The post of a `{ data: Post }` envelope. */
export function postOf(res: Response): PostJson {
  return member(res, 'data') as PostJson;
}

/** A `{ data: Post[], pagination }` envelope. */
export function listOf(res: Response): PostListJson {
  member(res, 'pagination');
  return res.body as PostListJson;
}

/** The error of an `{ error }` envelope. */
export function errorOf(res: Response): ErrorJson {
  return member(res, 'error') as ErrorJson;
}

export function idsOf(res: Response): string[] {
  return listOf(res).data.map((post) => post.id);
}

export function titlesOf(res: Response): string[] {
  return listOf(res).data.map((post) => post.title);
}

/** Validation details reduced to what clients branch on: location, field and code. */
export function issuesOf(res: Response): Issue[] {
  return (errorOf(res).details ?? []).map(({ location, field, code }) => ({
    location,
    field,
    code,
  }));
}

/** Asserts an error response with the given status and `error.code`, and returns the error. */
export function expectError(res: Response, status: number, code: string): ErrorJson {
  expect(res.status, res.text).toBe(status);
  expect(res.type).toBe('application/json');
  const error = errorOf(res);
  expect(error.code).toBe(code);
  return error;
}

/** Asserts a 400 VALIDATION_ERROR whose details are exactly `issues`. */
export function expectValidationError(res: Response, issues: readonly Issue[]): void {
  expectError(res, 400, 'VALIDATION_ERROR');
  expect(issuesOf(res)).toEqual(issues);
}

/** Asserts an API timestamp (ISO-8601 UTC) within `[from, to]`, both in epoch milliseconds. */
export function expectTimestampWithin(value: string | null, from: number, to: number): void {
  expect(value).toMatch(ISO_TIMESTAMP);
  const time = Date.parse(value ?? '');
  expect(time).toBeGreaterThanOrEqual(from);
  expect(time).toBeLessThanOrEqual(to);
}
