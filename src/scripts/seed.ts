import { loadConfig } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../infrastructure/database.js';
import { createLogger } from '../infrastructure/logger.js';
import { normalizeHashtags } from '../posts/hashtag.js';
import { AUTHOR_NAME } from '../posts/post.constants.js';
import { PostModel, type PostAttributes } from '../posts/post.model.js';

// Sample data for trying the API by hand. Usage:
//   npm run seed                 (development, seeds an empty database)
//   npm run seed -- --reset      (replaces every existing post)
//   docker compose exec api node dist/scripts/seed.js

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

interface SamplePost {
  readonly title: string;
  readonly body: string;
  readonly hashtags: readonly string[];
  /** null for a draft. */
  readonly publishedDaysAgo: number | null;
}

const SAMPLE_POSTS: readonly SamplePost[] = [
  {
    title: 'Hello, world: why this blog exists',
    body: 'A place to write about building backends: APIs, databases, testing and the trade-offs in between.',
    hashtags: ['meta', 'api'],
    publishedDaysAgo: 30,
  },
  {
    title: 'What changed in Express 5',
    body: 'Rejected promises reach the error handler on their own, req.query became a getter and path syntax got stricter.',
    hashtags: ['nodejs', 'express'],
    publishedDaysAgo: 21,
  },
  {
    title: 'Modeling a blog in MongoDB',
    body: 'One collection, embedded hashtags, and indexes designed from the queries the clients actually run.',
    hashtags: ['mongodb', 'nodejs', 'api'],
    publishedDaysAgo: 14,
  },
  {
    title: 'Strict input validation with zod',
    body: 'Unknown fields are rejected, every problem is reported at once, and handlers only ever see typed values.',
    hashtags: ['typescript', 'api'],
    publishedDaysAgo: 9,
  },
  {
    title: 'Testing against a real database',
    body: 'mongodb-memory-server gives every test file a real mongod, so sorting, indexes and atomic updates are actually exercised.',
    hashtags: ['testing', 'mongodb', 'nodejs'],
    publishedDaysAgo: 4,
  },
  {
    title: 'Idempotent state transitions',
    body: 'Publishing twice should be harmless: a conditional update makes the draft-to-published transition atomic.',
    hashtags: ['api', 'mongodb'],
    publishedDaysAgo: 1,
  },
  {
    title: 'Draft: pagination strategies',
    body: 'Offset or cursor? Notes for a future post.',
    hashtags: ['api', 'mongodb'],
    publishedDaysAgo: null,
  },
  {
    title: 'Draft: graceful shutdown in containers',
    body: 'SIGTERM, PID 1 and why npm start is not a good container entrypoint.',
    hashtags: ['nodejs', 'docker'],
    publishedDaysAgo: null,
  },
];

function toDocument(sample: SamplePost, now: number): PostAttributes & { createdAt: Date } {
  const publishedAt =
    sample.publishedDaysAgo === null ? null : new Date(now - sample.publishedDaysAgo * DAY_MS);
  return {
    title: sample.title,
    body: sample.body,
    hashtags: normalizeHashtags(sample.hashtags),
    status: publishedAt === null ? 'draft' : 'published',
    author: AUTHOR_NAME,
    publishedAt,
    // Written an hour before publication (drafts: an hour ago).
    createdAt: new Date((publishedAt?.getTime() ?? now) - HOUR_MS),
  };
}

async function seed(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  const reset = process.argv.includes('--reset');

  await connectDatabase(config.mongodbUri);
  try {
    await PostModel.init();

    const existing = await PostModel.countDocuments();
    if (existing > 0 && !reset) {
      logger.info(`Database already has ${existing} posts, skipping (use --reset to replace them)`);
      return;
    }
    if (reset) {
      const { deletedCount } = await PostModel.deleteMany({});
      logger.info(`Deleted ${deletedCount} existing posts`);
    }

    const now = Date.now();
    await PostModel.insertMany(SAMPLE_POSTS.map((sample) => toDocument(sample, now)));
    logger.info(`Inserted ${SAMPLE_POSTS.length} sample posts`);
  } finally {
    await disconnectDatabase();
  }
}

await seed();
