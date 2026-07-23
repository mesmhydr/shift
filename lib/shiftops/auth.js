import crypto from 'crypto';
import { getDb } from './db.js';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 50000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.pbkdf2Sync(password, salt, 50000, 64, 'sha512').toString('hex');
  return check === hash;
}

export function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

export async function getUserFromRequest(request) {
  const auth = request.headers.get('authorization');
  if (!auth) return null;
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const db = await getDb();
  const session = await db.collection('sessions').findOne({ token });
  if (!session) return null;
  const user = await db.collection('users').findOne({ id: session.userId });
  if (!user) return null;
  return { ...user, password: undefined };
}
