import { readFileSync } from 'node:fs';

import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';

// Resolved from this module, so it works from both src/http (tsx) and dist/http (compiled).
const OPENAPI_FILE = new URL('../../docs/openapi.yaml', import.meta.url);

let cachedDocument: Record<string, unknown> | undefined;

/** The hand-written OpenAPI contract, read and parsed once per process. */
export function loadOpenApiDocument(): Record<string, unknown> {
  cachedDocument ??= parse(readFileSync(OPENAPI_FILE, 'utf8')) as Record<string, unknown>;
  return cachedDocument;
}

const OPENAPI_JSON_PATH = '/api/v1/openapi.json';

/** Serves the contract as JSON (for codegen and API clients) and as interactive Swagger UI. */
export function createDocsRouter(): Router {
  const document = loadOpenApiDocument();
  const router = Router();

  router.get(OPENAPI_JSON_PATH, (_req, res) => {
    res.json(document);
  });

  // Swagger UI's static assets (this also redirects /docs to /docs/, which its relative asset
  // URLs need). The page itself answers only GET /docs/, so any other path or method under
  // /docs falls through to the regular JSON 404.
  router.use('/docs', swaggerUi.serve);
  router.get(
    '/docs/',
    // Swagger UI fetches the contract from the JSON endpoint. Passing the document to setup()
    // would embed it in swagger-ui-init.js through String.replace, which treats sequences such
    // as "$`" in the descriptions as replacement patterns and breaks the generated script.
    swaggerUi.setup(undefined, {
      customSiteTitle: 'WiNK Blog & CMS API',
      swaggerOptions: { url: OPENAPI_JSON_PATH, persistAuthorization: true },
    }),
  );

  return router;
}
