import type { z } from 'zod';

import { httpErrors, type ErrorDetail, type InputLocation } from './http-error.js';

/**
 * Validates one part of a request and returns its typed, normalized value, or throws a 400
 * listing every problem. Controllers call it explicitly because Express 5's `req.query` is a
 * read-only getter: parsed values live in local variables, never back on `req`.
 */
export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  location: InputLocation,
): z.output<Schema> {
  const result = schema.safeParse(value, { reportInput: true });
  if (result.success) {
    return result.data;
  }
  throw httpErrors.validation(result.error.issues.flatMap((issue) => toDetails(issue, location)));
}

function toDetails(issue: z.core.$ZodIssue, location: InputLocation): ErrorDetail[] {
  const path = issue.path.map(String);

  // One detail per unknown key, so a client can point at each offending field.
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({
      location,
      field: [...path, key].join('.'),
      code: 'unknown_field',
      message: `${key} is not an accepted field`,
    }));
  }

  const field = path.length > 0 ? path.join('.') : null;
  // `input` is only read to tell "missing" from "wrong type"; it is never echoed back.
  if (issue.code === 'invalid_type' && issue.input === undefined && field !== null) {
    return [{ location, field, code: 'required', message: `${field} is required` }];
  }

  return [{ location, field, code: toDetailCode(issue.code), message: issue.message }];
}

/** The documented subset of validator issue codes; anything else is reported as `invalid`. */
const DOCUMENTED_ISSUE_CODES = new Set([
  'invalid_type',
  'too_small',
  'too_big',
  'invalid_format',
  'invalid_value',
]);

function toDetailCode(issueCode: string): string {
  return DOCUMENTED_ISSUE_CODES.has(issueCode) ? issueCode : 'invalid';
}
