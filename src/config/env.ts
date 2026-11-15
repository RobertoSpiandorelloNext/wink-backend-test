import { z } from 'zod';

/**
 * The hardcoded CMS token allowed by Note 1 of the brief. It is documented in the README and in the
 * OpenAPI description, and can be overridden with the CMS_API_TOKEN environment variable.
 */
export const DEFAULT_CMS_API_TOKEN = 'wink-cms-demo-token';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

// Environment variables are always strings, and process.env holds many unrelated keys,
// so this is a loose z.object (unknown keys ignored) with explicit string parsing.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z
    .string()
    .regex(/^\d+$/, { error: 'must be an integer' })
    .transform(Number)
    .pipe(z.int().min(1).max(65_535))
    .default(3000),
  MONGODB_URI: z
    .string()
    // z.url() would reject valid multi-host replica-set URIs, so only the scheme is checked.
    .regex(/^mongodb(\+srv)?:\/\/.+/, { error: 'must start with mongodb:// or mongodb+srv://' })
    .default('mongodb://127.0.0.1:27017/wink-blog'),
  CMS_API_TOKEN: z
    .string()
    .min(16, { error: 'must be at least 16 characters long' })
    .default(DEFAULT_CMS_API_TOKEN),
  CORS_ORIGINS: z
    .string()
    .transform((value): '*' | string[] =>
      value.trim() === '*'
        ? '*'
        : value
            .split(',')
            .map((origin) => origin.trim())
            .filter((origin) => origin.length > 0),
    )
    .default('*'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly mongodbUri: string;
  readonly cmsApiToken: string;
  readonly corsOrigins: '*' | readonly string[];
  readonly logLevel: LogLevel;
}

/** Thrown by {@link loadConfig}; the message lists every invalid variable at once. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * Reads and validates the configuration once, at startup, so a misconfigured deployment fails fast
 * with a readable message instead of failing on the first request.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new ConfigError(`Invalid environment configuration:\n${problems.join('\n')}`);
  }

  const { NODE_ENV, PORT, MONGODB_URI, CMS_API_TOKEN, CORS_ORIGINS, LOG_LEVEL } = result.data;
  return Object.freeze({
    nodeEnv: NODE_ENV,
    port: PORT,
    mongodbUri: MONGODB_URI,
    cmsApiToken: CMS_API_TOKEN,
    corsOrigins: CORS_ORIGINS,
    logLevel: LOG_LEVEL,
  });
}
