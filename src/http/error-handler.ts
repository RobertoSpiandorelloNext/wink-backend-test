import type { ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';

import { HttpError, httpErrors } from './http-error.js';
import { getRequestId } from './middleware/request-logger.js';

/**
 * The single place where errors become HTTP responses, so every failure has the same envelope:
 * `{ error: { code, message, details?, requestId } }`.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const httpError = toHttpError(err);
  if (httpError.status >= 500) {
    // pino-http logs the request once, at error level, with this error and its stack.
    res.err = err instanceof Error ? err : new Error(String(err));
  }

  res.status(httpError.status).set(httpError.headers);
  res.json({
    error: {
      code: httpError.code,
      message: httpError.message,
      ...(httpError.details && { details: httpError.details }),
      requestId: getRequestId(req),
    },
  });
};

/**
 * Maps anything thrown during a request to a known HTTP error. The original status and message
 * are never forwarded: they may contain internals, so they are logged but not sent to clients.
 */
export function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) {
    return err;
  }
  if (isDatabaseUnavailableError(err)) {
    return httpErrors.serviceUnavailable();
  }
  const bodyParserError = BODY_PARSER_ERRORS[errorType(err) ?? ''];
  if (bodyParserError) {
    return bodyParserError();
  }
  // Errors that Express or body-parser flag as the client's fault (4xx) before any handler
  // runs: a malformed percent-encoded path, a corrupt compressed body, an aborted upload...
  if (isClientError(err)) {
    return httpErrors.badRequest();
  }
  return httpErrors.internal();
}

/** body-parser errors are identified by their `type`, never by their message. */
const BODY_PARSER_ERRORS: Partial<Record<string, () => HttpError>> = {
  'entity.parse.failed': httpErrors.invalidJson,
  'entity.too.large': httpErrors.payloadTooLarge,
  'charset.unsupported': () =>
    httpErrors.unsupportedMediaType('Only UTF-8 encoded JSON bodies are supported'),
  'encoding.unsupported': () => httpErrors.unsupportedMediaType('Unsupported Content-Encoding'),
};

function errorType(err: unknown): string | undefined {
  return err instanceof Error && 'type' in err && typeof err.type === 'string'
    ? err.type
    : undefined;
}

function isClientError(err: unknown): boolean {
  return (
    err instanceof Error &&
    'status' in err &&
    typeof err.status === 'number' &&
    err.status >= 400 &&
    err.status < 500
  );
}

const DATABASE_UNAVAILABLE_ERRORS = new Set([
  'MongoServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
]);

function isDatabaseUnavailableError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  // Mongoose reports a query that waited too long for a connection as a buffering timeout.
  const isBufferingTimeout =
    err instanceof mongoose.Error && err.message.includes('buffering timed out');
  return DATABASE_UNAVAILABLE_ERRORS.has(err.name) || isBufferingTimeout;
}
