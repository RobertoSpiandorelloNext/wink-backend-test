import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import type { AppConfig } from './config/env.js';
import { createHealthRouter } from './health/health.router.js';
import { createDocsRouter } from './http/docs.router.js';
import { errorHandler } from './http/error-handler.js';
import { notFound } from './http/middleware/not-found.js';
import { requestLogger } from './http/middleware/request-logger.js';
import type { Logger } from './infrastructure/logger.js';
import { createBlogRouter } from './posts/blog.router.js';
import { createCmsRouter } from './posts/cms.router.js';

export interface AppDependencies {
  readonly config: AppConfig;
  readonly logger: Logger;
}

/**
 * Builds the Express application. No network I/O happens here (no listen, no database
 * connection), so tests can drive the app directly with supertest.
 */
export function createApp({ config, logger }: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  // Express 5's default, set explicitly: no nested objects in query strings (?a[$ne]=1).
  app.set('query parser', 'simple');

  app.use(requestLogger(logger));
  app.use(
    helmet({
      // Swagger UI must also load over plain HTTP (e.g. through a LAN address or a container host).
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    }),
  );
  // Before the CMS token guard, so that browser preflight requests (sent without credentials)
  // are answered instead of rejected with 401.
  app.use(
    cors({
      origin: config.corsOrigins === '*' ? '*' : [...config.corsOrigins],
      methods: ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      exposedHeaders: ['Location', 'X-Request-Id'],
      maxAge: 600,
    }),
  );

  app.get('/', (_req, res) => {
    res.redirect(302, '/docs');
  });
  app.use(createHealthRouter());
  app.use(createDocsRouter());
  app.use('/api/v1/blog', createBlogRouter());
  app.use('/api/v1/cms', createCmsRouter(config));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
