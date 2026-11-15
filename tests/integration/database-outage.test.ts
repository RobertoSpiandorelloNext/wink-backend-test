import mongoose from 'mongoose';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { auth, createTestApp } from '../helpers/app.js';
import { expectError } from '../helpers/responses.js';

// This file never connects to MongoDB, which is what an outage looks like to the application:
// Mongoose holds every query in its buffer until the buffer timeout, then fails it.

const app = createTestApp();

beforeAll(() => {
  // The application waits 5 s before giving up; a shorter wait keeps this file fast. The failure,
  // and therefore the response it maps to, is the same.
  mongoose.set('bufferTimeoutMS', 200);
});

describe('while the database is unreachable', () => {
  it('GET /health answers 503 with the database down', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', database: 'down' });
  });

  it.each([
    { route: 'GET /api/v1/blog/posts', send: () => request(app).get('/api/v1/blog/posts') },
    {
      route: 'GET /api/v1/cms/posts',
      send: () => request(app).get('/api/v1/cms/posts').set(auth()),
    },
    {
      route: 'POST /api/v1/cms/posts',
      send: () =>
        request(app).post('/api/v1/cms/posts').set(auth()).send({ title: 'T', body: 'B' }),
    },
  ])('$route answers 503 SERVICE_UNAVAILABLE with Retry-After', async ({ send }) => {
    const res = await send();

    const error = expectError(res, 503, 'SERVICE_UNAVAILABLE');
    expect(res.get('Retry-After')).toBe('5');
    expect(error.requestId).toBe(res.get('X-Request-Id'));
  });
});
