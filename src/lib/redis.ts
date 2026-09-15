import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Redis is optional, and a cache must never take down the thing it caches.
 *
 * The client was constructed unconditionally against redis://localhost:6379,
 * and `/guard/velocity` and `/registry/events` awaited it before doing any
 * work. On any host without a local Redis — which is every host this has ever
 * been deployed to — the cache lookup for a read that needs no cache at all
 * was what failed the request.
 *
 * So: no REDIS_URL means no cache, reads go straight to Soroban, and a cache
 * that is configured but unreachable degrades to a miss instead of a 500.
 * The challenge store is the one place where absence is NOT survivable, and
 * that is handled separately in `challengeStoreStatus` below.
 */
export const REDIS_URL = process.env.REDIS_URL ?? '';

export const redis = REDIS_URL
  ? new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 })
  : null;

redis?.on('error', (err) => console.error('[redis] error:', err.message));

/** Run a Redis operation, or give up quietly. For caches only. */
async function optional<T>(fn: (r: Redis) => Promise<T>): Promise<T | null> {
  if (!redis) return null;
  try {
    return await fn(redis);
  } catch (err) {
    console.error('[redis] degraded to no-cache:', (err as Error).message);
    return null;
  }
}

// -- WebAuthn challenges ------------------------------------------------------

/** Challenge TTL: 5 minutes. */
const CHALLENGE_TTL = 300;

/**
 * Why a challenge cannot fall back to memory.
 *
 * The point of a challenge is that the client did not choose it and cannot
 * reuse it. Both properties need one store that every instance shares and that
 * a value can be deleted from. A per-process Map gives neither on a platform
 * that runs more than one instance, and silently accepting a weaker check is
 * exactly the failure mode the rest of this codebase has been cleared of. So
 * when there is no shared store the auth routes refuse, loudly, and say why.
 */
export function challengeStoreStatus(): { available: boolean; reason?: string } {
  if (redis) return { available: true };
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  return {
    available: false,
    reason: serverless
      ? 'Passkey registration needs a shared challenge store. Set REDIS_URL on this deployment.'
      : 'REDIS_URL is not set, so there is nowhere to keep a WebAuthn challenge.',
  };
}

export async function setChallenge(userId: string, challenge: string): Promise<void> {
  if (!redis) throw new Error(challengeStoreStatus().reason);
  await redis.set(`challenge:${userId}`, challenge, 'EX', CHALLENGE_TTL);
}

/** Read a challenge and delete it, so it is good exactly once. */
export async function popChallenge(userId: string): Promise<string | null> {
  if (!redis) throw new Error(challengeStoreStatus().reason);
  const val = await redis.get(`challenge:${userId}`);
  if (val) await redis.del(`challenge:${userId}`);
  return val;
}

// -- Event cache --------------------------------------------------------------

const EVENT_TTL = 60;

export async function cacheEvents(key: string, data: unknown): Promise<void> {
  await optional((r) => r.set(`events:${key}`, JSON.stringify(data), 'EX', EVENT_TTL));
}

export async function getCachedEvents(key: string): Promise<unknown | null> {
  const raw = await optional((r) => r.get(`events:${key}`));
  return raw ? JSON.parse(raw) : null;
}
