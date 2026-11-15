import { Writable } from 'node:stream';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/infrastructure/logger.js';
import { TEST_TOKEN } from '../helpers/app.js';

// Uses the production logger (not the silent one of the other tests) to check what reaches the logs.
// The requests below are rejected before any database access, so no database is needed.

interface LogEntry {
  level: number;
  req?: { id?: string; headers?: Record<string, string> };
  res?: Record<string, unknown>;
}

function createLoggedApp(): { app: ReturnType<typeof createApp>; entries: () => LogEntry[] } {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const config = loadConfig({ NODE_ENV: 'test', CMS_API_TOKEN: TEST_TOKEN });
  const app = createApp({ config, logger: createLogger({ level: 'info' }, sink) });
  return { app, entries: () => lines.map((line) => JSON.parse(line) as LogEntry) };
}

describe('request logging', () => {
  it('never writes the bearer token or cookies to the logs', async () => {
    const { app, entries } = createLoggedApp();

    await request(app)
      .get('/api/v1/cms/posts/not-an-id')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .set('Cookie', 'session=top-secret');

    const [entry] = entries();
    expect(entry?.req?.headers).toMatchObject({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
    });
    const raw = JSON.stringify(entries());
    expect(raw).not.toContain(TEST_TOKEN);
    expect(raw).not.toContain('top-secret');
  });

  it('logs one line per request with its id and only the response status', async () => {
    const { app, entries } = createLoggedApp();

    const res = await request(app).get('/api/v1/blog/posts/not-an-id');

    expect(entries()).toHaveLength(1);
    const [entry] = entries();
    expect(entry?.req?.id).toBe(res.headers['x-request-id']);
    expect(entry?.res).toEqual({ statusCode: 400 });
    expect(entry?.level).toBe(40); // warn: a client error
  });

  it('does not log health checks', async () => {
    const { app, entries } = createLoggedApp();

    await request(app).get('/health');

    expect(entries()).toHaveLength(0);
  });
});
