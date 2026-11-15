import { randomUUID } from 'node:crypto';

import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, inject } from 'vitest';

import { PostModel } from '../../src/posts/post.model.js';

/**
 * Connects the calling test file to a database of its own on the in-memory MongoDB server started
 * by tests/global-setup.ts, so test files run in parallel without sharing data. Every test starts
 * with empty collections; indexes are kept, so queries run against the real index definitions.
 */
export function useTestDatabase(): void {
  beforeAll(async () => {
    await mongoose.connect(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
    await PostModel.init();
  });

  afterEach(async () => {
    const collections = Object.values(mongoose.connection.collections);
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}
