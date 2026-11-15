import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

/**
 * Starts a single in-memory MongoDB server for the whole test run.
 * Each test file connects to its own database on this server (see tests/helpers),
 * so files can run in parallel without sharing state.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const mongod = await MongoMemoryServer.create();
  project.provide('mongoUri', mongod.getUri());

  return async () => {
    await mongod.stop();
  };
}
