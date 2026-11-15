import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

import type { LogLevel } from '../config/env.js';

export type { Logger };

/**
 * Structured JSON logs on stdout (12-factor). Pretty printing is a development concern handled
 * outside the process (`npm run dev` pipes into pino-pretty), so production needs no transports.
 * `destination` lets tests inspect what would be written; by default pino writes synchronously to
 * stdout, so a fatal log line is not lost when the process exits right after it.
 */
export function createLogger(
  options: { level: LogLevel },
  destination?: DestinationStream,
): Logger {
  const loggerOptions: LoggerOptions = {
    level: options.level,
    redact: {
      // The CMS bearer token must never end up in logs.
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      censor: '[REDACTED]',
    },
  };
  return destination ? pino(loggerOptions, destination) : pino(loggerOptions);
}
