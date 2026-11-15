import { z } from 'zod';

export const DEFAULT_PAGE = 1;
export const MAX_PAGE = 1_000;
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;

export interface Pagination {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

/** A page of items plus what a client needs to render a pager. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly pagination: Pagination;
}

/**
 * A positive integer query parameter. Digits only: `z.coerce.number()` would accept `''` (as 0),
 * `1e2` or `0x10`. Out-of-range values are rejected rather than silently clamped.
 */
function integerParam(name: string, max: number, fallback: number) {
  return z
    .string()
    .regex(/^\d+$/, { error: `${name} must be a positive integer` })
    .transform(Number)
    .pipe(
      z
        .int()
        .min(1, { error: `${name} must be at least 1` })
        .max(max, { error: `${name} must be at most ${max}` }),
    )
    .default(fallback);
}

/** Query fields shared by every paginated list. */
export const paginationQuery = {
  page: integerParam('page', MAX_PAGE, DEFAULT_PAGE),
  limit: integerParam('limit', MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE),
};

export function toPagination(page: number, limit: number, total: number): Pagination {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}
