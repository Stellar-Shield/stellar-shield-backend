import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

redis.on('error', (err) => console.error('[redis] error:', err.message));

// Challenge TTL: 5 minutes
const CHALLENGE_TTL = 300;

export async function setChallenge(userId: string, challenge: string): Promise<void> {
  await redis.set(`challenge:${userId}`, challenge, 'EX', CHALLENGE_TTL);
}

export async function popChallenge(userId: string): Promise<string | null> {
  const val = await redis.get(`challenge:${userId}`);
  if (val) await redis.del(`challenge:${userId}`);
  return val;
}

// Event cache TTL: 60 seconds
const EVENT_TTL = 60;

export async function cacheEvents(key: string, data: unknown): Promise<void> {
  await redis.set(`events:${key}`, JSON.stringify(data), 'EX', EVENT_TTL);
}

export async function getCachedEvents(key: string): Promise<unknown | null> {
  const raw = await redis.get(`events:${key}`);
  return raw ? JSON.parse(raw) : null;
}
