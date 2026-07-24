import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

const databaseUrl =
  process.env.DATABASE_URL || 'postgres://127.0.0.1:5432/shiftops';

const queryClient = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, {
  schema,
});

export { queryClient };