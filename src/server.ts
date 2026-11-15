import { createServer } from 'node:http';

import { createApp } from './app.js';
import { ConfigError, DEFAULT_CMS_API_TOKEN, loadConfig, type AppConfig } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './infrastructure/database.js';
import { createLogger } from './infrastructure/logger.js';
import { PostModel } from './posts/post.model.js';

/** Must stay below the container's stop grace period (Docker's default is 10 s). */
const SHUTDOWN_TIMEOUT_MS = 8_000;

async function main(): Promise<void> {
  const config = loadConfigOrExit();
  const logger = createLogger({ level: config.logLevel });

  // Connect (and build indexes) before accepting traffic: requests that can only fail are never served.
  try {
    await connectDatabase(config.mongodbUri);
    await PostModel.init();
  } catch (error) {
    logger.fatal({ err: error }, 'Cannot connect to MongoDB');
    process.exit(1);
  }
  logger.info('Connected to MongoDB');

  if (config.cmsApiToken === DEFAULT_CMS_API_TOKEN && config.nodeEnv !== 'test') {
    logger.warn(
      'The CMS is protected by the documented demo token: set CMS_API_TOKEN to change it',
    );
  }

  const server = createServer(createApp({ config, logger }));
  server.on('error', (error) => {
    logger.fatal({ err: error }, 'HTTP server failed');
    process.exit(1);
  });
  server.listen(config.port, () => {
    const url = `http://localhost:${config.port}`;
    logger.info(`Listening on ${url} (API docs: ${url}/docs)`);
  });

  let shuttingDown = false;
  async function shutdown(reason: string, exitCode: number): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ reason }, 'Shutting down');

    // A stuck request must not keep the process alive forever.
    setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      server.closeAllConnections();
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    // Stop accepting connections and let in-flight requests finish, then release MongoDB.
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    await disconnectDatabase();
    process.exit(exitCode);
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal, 0);
    });
  }
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    void shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    void shutdown('uncaughtException', 1);
  });
}

function loadConfigOrExit(): AppConfig {
  try {
    return loadConfig();
  } catch (error) {
    // The logger is configured from the configuration, so this is the one direct write to stderr.
    console.error(error instanceof ConfigError ? error.message : error);
    process.exit(1);
  }
}

void main();
