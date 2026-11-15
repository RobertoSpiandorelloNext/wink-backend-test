import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigError, DEFAULT_CMS_API_TOKEN, loadConfig } from '../../src/config/env.js';

/** Runs loadConfig expecting it to fail, and returns the error. */
function configErrorFor(env: NodeJS.ProcessEnv): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected loadConfig to throw a ConfigError');
}

// The error message is meant for an operator reading a failed deployment: it must name every
// invalid variable. Only the names are asserted, never the wording.

describe('loadConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the documented defaults', () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: 'development',
      port: 3000,
      mongodbUri: 'mongodb://127.0.0.1:27017/wink-blog',
      cmsApiToken: 'wink-cms-demo-token',
      corsOrigins: '*',
      logLevel: 'info',
    });
  });

  it('exports the documented demo token', () => {
    expect(DEFAULT_CMS_API_TOKEN).toBe('wink-cms-demo-token');
  });

  it('reads every variable', () => {
    expect(
      loadConfig({
        NODE_ENV: 'production',
        PORT: '8080',
        MONGODB_URI: 'mongodb+srv://cluster0.example.net/blog',
        CMS_API_TOKEN: 'a-production-token',
        CORS_ORIGINS: 'https://blog.example.com',
        LOG_LEVEL: 'warn',
      }),
    ).toEqual({
      nodeEnv: 'production',
      port: 8080,
      mongodbUri: 'mongodb+srv://cluster0.example.net/blog',
      cmsApiToken: 'a-production-token',
      corsOrigins: ['https://blog.example.com'],
      logLevel: 'warn',
    });
  });

  it('reads process.env when called without arguments', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PORT', '4321');
    vi.stubEnv('MONGODB_URI', 'mongodb://db.internal:27017/blog');
    vi.stubEnv('CMS_API_TOKEN', 'token-from-process-env');
    vi.stubEnv('CORS_ORIGINS', '*');
    vi.stubEnv('LOG_LEVEL', 'debug');
    expect(loadConfig()).toEqual({
      nodeEnv: 'production',
      port: 4321,
      mongodbUri: 'mongodb://db.internal:27017/blog',
      cmsApiToken: 'token-from-process-env',
      corsOrigins: '*',
      logLevel: 'debug',
    });
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(loadConfig({}))).toBe(true);
  });

  it('ignores unrelated variables', () => {
    expect(() =>
      loadConfig({ PATH: '/usr/bin', HOME: '/home/node', npm_lifecycle_event: 'start' }),
    ).not.toThrow();
  });

  describe('NODE_ENV', () => {
    it.each(['development', 'test', 'production'])('accepts %s', (value) => {
      expect(loadConfig({ NODE_ENV: value }).nodeEnv).toBe(value);
    });

    it('rejects other environments', () => {
      expect(configErrorFor({ NODE_ENV: 'staging' }).message).toContain('NODE_ENV');
    });
  });

  describe('PORT', () => {
    it.each([
      ['1', 1],
      ['8080', 8080],
      ['65535', 65_535],
    ])('accepts %s', (value, port) => {
      expect(loadConfig({ PORT: value }).port).toBe(port);
    });

    it.each(['0', '65536', '-1', '3000.5', '3e3', 'abc'])('rejects %j', (value) => {
      expect(configErrorFor({ PORT: value }).message).toContain('PORT');
    });
  });

  describe('MONGODB_URI', () => {
    it.each([
      'mongodb://localhost:27017/blog',
      'mongodb+srv://cluster0.example.net/blog',
      'mongodb://user:secret@db1:27017,db2:27017/blog?replicaSet=rs0',
    ])('accepts %s', (uri) => {
      expect(loadConfig({ MONGODB_URI: uri }).mongodbUri).toBe(uri);
    });

    it.each(['http://localhost:27017/blog', 'localhost:27017', 'postgres://localhost/blog'])(
      'rejects %s',
      (uri) => {
        expect(configErrorFor({ MONGODB_URI: uri }).message).toContain('MONGODB_URI');
      },
    );
  });

  describe('CMS_API_TOKEN', () => {
    it('accepts a token of 16 characters', () => {
      expect(loadConfig({ CMS_API_TOKEN: 'sixteen-chars-ok' }).cmsApiToken).toBe(
        'sixteen-chars-ok',
      );
    });

    it('rejects a shorter token without echoing it', () => {
      const message = configErrorFor({ CMS_API_TOKEN: 'short-secret-15' }).message;
      expect(message).toContain('CMS_API_TOKEN');
      expect(message).not.toContain('short-secret-15');
    });
  });

  describe('CORS_ORIGINS', () => {
    it('accepts * for any origin', () => {
      expect(loadConfig({ CORS_ORIGINS: '*' }).corsOrigins).toBe('*');
    });

    it('parses a comma-separated list of origins, trimming whitespace', () => {
      expect(
        loadConfig({ CORS_ORIGINS: 'https://blog.example.com, https://cms.example.com' })
          .corsOrigins,
      ).toEqual(['https://blog.example.com', 'https://cms.example.com']);
    });
  });

  describe('LOG_LEVEL', () => {
    it.each(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])(
      'accepts %s',
      (level) => {
        expect(loadConfig({ LOG_LEVEL: level }).logLevel).toBe(level);
      },
    );

    it('rejects unknown levels', () => {
      expect(configErrorFor({ LOG_LEVEL: 'verbose' }).message).toContain('LOG_LEVEL');
    });
  });

  it('reports every invalid variable in a single error', () => {
    const { message } = configErrorFor({
      PORT: 'abc',
      MONGODB_URI: 'http://localhost',
      CMS_API_TOKEN: 'short',
      LOG_LEVEL: 'info',
    });
    expect(message).toContain('PORT');
    expect(message).toContain('MONGODB_URI');
    expect(message).toContain('CMS_API_TOKEN');
    expect(message).not.toContain('LOG_LEVEL');
  });
});
