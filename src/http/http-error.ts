/** Stable, documented error codes. Clients branch on the HTTP status plus this code. */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'INVALID_JSON'
  | 'UNAUTHORIZED'
  | 'POST_NOT_FOUND'
  | 'ROUTE_NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

export type InputLocation = 'params' | 'query' | 'body';

/** One problem found while validating a request. */
export interface ErrorDetail {
  readonly location: InputLocation;
  /** Dotted path (`hashtags.2`), or null when the problem concerns the whole input. */
  readonly field: string | null;
  /** `required`, `unknown_field`, or the validator's issue code (e.g. `too_big`). */
  readonly code: string;
  readonly message: string;
}

interface HttpErrorOptions {
  readonly details?: readonly ErrorDetail[];
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * An error that maps to a specific HTTP response. Route code throws it; the error handler is the
 * only place that turns it into a response body.
 */
export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: readonly ErrorDetail[] | undefined;
  readonly headers: Readonly<Record<string, string>>;

  constructor(status: number, code: ErrorCode, message: string, options: HttpErrorOptions = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.headers = options.headers ?? {};
  }
}

const BEARER_CHALLENGE = 'Bearer realm="cms"';

export const httpErrors = {
  badRequest: (): HttpError =>
    new HttpError(400, 'BAD_REQUEST', 'The request is malformed and cannot be processed'),

  validation: (details: readonly ErrorDetail[]): HttpError =>
    new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', { details }),

  invalidJson: (): HttpError =>
    new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON'),

  missingToken: (): HttpError =>
    new HttpError(401, 'UNAUTHORIZED', 'A bearer token is required for CMS endpoints', {
      headers: { 'WWW-Authenticate': BEARER_CHALLENGE },
    }),

  invalidToken: (): HttpError =>
    new HttpError(401, 'UNAUTHORIZED', 'The bearer token is invalid', {
      headers: { 'WWW-Authenticate': `${BEARER_CHALLENGE}, error="invalid_token"` },
    }),

  postNotFound: (): HttpError => new HttpError(404, 'POST_NOT_FOUND', 'Post not found'),

  routeNotFound: (method: string, path: string): HttpError =>
    new HttpError(404, 'ROUTE_NOT_FOUND', `Route ${method} ${path} does not exist`),

  methodNotAllowed: (method: string, allowed: readonly string[]): HttpError =>
    new HttpError(405, 'METHOD_NOT_ALLOWED', `Method ${method} is not allowed on this resource`, {
      headers: { Allow: allowed.join(', ') },
    }),

  payloadTooLarge: (): HttpError =>
    new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large'),

  unsupportedMediaType: (message = 'Request body must be application/json'): HttpError =>
    new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', message),

  internal: (): HttpError => new HttpError(500, 'INTERNAL_ERROR', 'An unexpected error occurred'),

  serviceUnavailable: (): HttpError =>
    new HttpError(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable', {
      headers: { 'Retry-After': '5' },
    }),
};
