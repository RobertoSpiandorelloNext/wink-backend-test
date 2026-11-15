import type { Express } from 'express';
import { pino } from 'pino';

import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';

/**
 * The CMS token accepted by {@link createTestApp}. Deliberately not the documented demo token, so
 * the tests prove that the configured token is the one being checked.
 */
export const TEST_TOKEN = 'test-cms-token-0123456789';

/**
 * Builds the real application with an explicit test configuration and a silent logger. `env`
 * overrides environment variables exactly as a deployment would (`undefined` unsets one).
 */
export function createTestApp(env: NodeJS.ProcessEnv = {}): Express {
  const config = loadConfig({ NODE_ENV: 'test', CMS_API_TOKEN: TEST_TOKEN, ...env });
  return createApp({ config, logger: pino({ level: 'silent' }) });
}

/** The `Authorization` header of a CMS client: `.set(auth())`. */
export function auth(token = TEST_TOKEN): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
