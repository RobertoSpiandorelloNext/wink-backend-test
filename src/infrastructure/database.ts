import mongoose from 'mongoose';

/** How long to wait for MongoDB before failing a request (or the startup) instead of hanging. */
const DATABASE_TIMEOUT_MS = 5_000;

// Only fields declared in a schema may be used in query filters.
mongoose.set('strictQuery', true);
// While disconnected, Mongoose buffers queries; fail them quickly so clients get a 503.
mongoose.set('bufferTimeoutMS', DATABASE_TIMEOUT_MS);

export async function connectDatabase(uri: string): Promise<void> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: DATABASE_TIMEOUT_MS });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}
