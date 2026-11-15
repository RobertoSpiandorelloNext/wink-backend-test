import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';

import { toHttpError } from '../../src/http/error-handler.js';
import { httpErrors } from '../../src/http/http-error.js';

/** Nothing listens on port 1 of the loopback interface, so server selection always fails. */
const UNREACHABLE_MONGODB_URI = 'mongodb://127.0.0.1:1/';

async function rejectionOf(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to fail');
}

/**
 * An error as raised by body-parser: identified by its `type`. Its `status` and message are those
 * of the library, which the API must not trust blindly.
 */
function bodyParserError(type: string, status: number): Error {
  return Object.assign(new Error('Library message'), { type, status, statusCode: status });
}

function expectServiceUnavailable(error: unknown): void {
  expect(toHttpError(error)).toMatchObject({
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
    headers: { 'Retry-After': '5' },
  });
}

describe('toHttpError', () => {
  it('returns an HttpError unchanged', () => {
    const error = httpErrors.postNotFound();
    expect(toHttpError(error)).toBe(error);
  });

  describe('body-parser errors', () => {
    it.each([
      { type: 'entity.parse.failed', status: 400, code: 'INVALID_JSON' },
      { type: 'entity.too.large', status: 413, code: 'PAYLOAD_TOO_LARGE' },
      { type: 'charset.unsupported', status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' },
      { type: 'encoding.unsupported', status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' },
    ])('maps $type to $status $code', ({ type, status, code }) => {
      expect(toHttpError(bodyParserError(type, status))).toMatchObject({ status, code });
    });

    it('are recognized by type, not by message', () => {
      const lookalike = new Error('Unexpected token } in JSON at position 10');
      expect(toHttpError(lookalike)).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    });

    it('of another type become 400 BAD_REQUEST when flagged as a client error', () => {
      expect(toHttpError(bodyParserError('request.aborted', 400))).toMatchObject({
        status: 400,
        code: 'BAD_REQUEST',
      });
    });

    it('of another type become 500 when flagged as a server error', () => {
      expect(toHttpError(bodyParserError('stream.not.readable', 500))).toMatchObject({
        status: 500,
        code: 'INTERNAL_ERROR',
      });
    });
  });

  describe('other client errors raised before the handlers run', () => {
    it('maps a path that cannot be percent-decoded (Express URIError) to 400 BAD_REQUEST', () => {
      const error = Object.assign(new URIError("Failed to decode param '%E0%A4%A'"), {
        status: 400,
      });
      const mapped = toHttpError(error);
      expect(mapped).toMatchObject({ status: 400, code: 'BAD_REQUEST' });
      expect(mapped.message).not.toContain('%E0%A4%A');
    });

    it('maps a corrupt compressed body (zlib error flagged 400) to 400 BAD_REQUEST', () => {
      const error = Object.assign(new Error('incorrect header check'), { status: 400 });
      expect(toHttpError(error)).toMatchObject({ status: 400, code: 'BAD_REQUEST' });
    });
  });

  describe('database outages', () => {
    it('maps a server selection timeout (MongoServerSelectionError) to 503', async () => {
      const client = new mongoose.mongo.MongoClient(UNREACHABLE_MONGODB_URI, {
        serverSelectionTimeoutMS: 100,
      });
      const error = await rejectionOf(client.db('probe').command({ ping: 1 }));
      await client.close();

      expect(error).toBeInstanceOf(mongoose.mongo.MongoServerSelectionError);
      expectServiceUnavailable(error);
    });

    it('maps an operation on a closed client (MongoNotConnectedError) to 503', async () => {
      const client = new mongoose.mongo.MongoClient(UNREACHABLE_MONGODB_URI);
      await client.close();
      const error = await rejectionOf(client.db('probe').command({ ping: 1 }));

      expect(error).toBeInstanceOf(mongoose.mongo.MongoNotConnectedError);
      expectServiceUnavailable(error);
    });

    it('maps a network error (MongoNetworkError) to 503', () => {
      expectServiceUnavailable(new mongoose.mongo.MongoNetworkError('connection reset by peer'));
    });

    it('maps a Mongoose buffering timeout (no connection) to 503', async () => {
      const neverOpened = mongoose.createConnection();
      const Probe = neverOpened.model(
        'Probe',
        new mongoose.Schema({ name: String }, { bufferTimeoutMS: 50 }),
      );
      const error = await rejectionOf(Probe.findOne().exec());
      await neverOpened.close();

      expect(error).toBeInstanceOf(mongoose.Error);
      expectServiceUnavailable(error);
    });
  });

  describe('anything else', () => {
    it('becomes a generic 500 that reveals nothing about the cause', () => {
      const error = toHttpError(new Error('E11000 duplicate key at mongodb://admin:secret@db'));
      expect(error).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
      expect(error.message).not.toMatch(/E11000|secret|mongodb/);
      expect(error.details).toBeUndefined();
    });

    it('never forwards the status or message carried by an error', () => {
      const teapot = Object.assign(new Error('I am a teapot'), { status: 418, statusCode: 418 });
      const mapped = toHttpError(teapot);
      expect(mapped).toMatchObject({ status: 400, code: 'BAD_REQUEST' });
      expect(mapped.message).not.toContain('teapot');

      const serverSide = Object.assign(new Error('upstream exploded'), { status: 502 });
      expect(toHttpError(serverSide)).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    });

    it.each([
      ['string', 'boom'],
      ['null', null],
      ['undefined', undefined],
      ['plain object', { status: 400, message: 'Bad Request' }],
    ])('maps a thrown %s to 500', (_, thrown) => {
      expect(toHttpError(thrown)).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    });
  });
});
