import { MongoClient } from 'mongodb';

let cachedClient = null;
let cachedDb = null;

export async function getDb() {
  if (cachedDb) return cachedDb;
  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.MONGO_URL);
    await cachedClient.connect();
  }
  cachedDb = cachedClient.db(process.env.DB_NAME || 'shiftops');
  return cachedDb;
}
