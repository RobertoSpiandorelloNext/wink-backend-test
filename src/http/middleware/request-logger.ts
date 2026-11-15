import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import type { RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';

import type { Logger } from '../../infrastructure/logger.js';

const REQUEST_ID_HEADER = 'X-Request-Id';
/** Inbound ids are reused only if they are short and safe to log. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Logs one line per request and gives every request an id, echoed in the `X-Request-Id`
 * response header and in error bodies, so a client can report exactly which call failed.
 */
export function requestLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const inbound = req.headers['x-request-id'];
      const id =
        typeof inbound === 'string' && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
      res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    autoLogging: { ignore: (req) => req.url === '/health' },
    customLogLevel: (_req, res, error) => {
      if (error !== undefined || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    // Response headers (mostly helmet's) add noise to every line without helping diagnosis.
    serializers: { res: ({ statusCode }: { statusCode: number }) => ({ statusCode }) },
  });
}

/** The id {@link requestLogger} assigned to this request (always a string). */
export function getRequestId(req: IncomingMessage): string {
  return typeof req.id === 'object' ? JSON.stringify(req.id) : String(req.id);
}
