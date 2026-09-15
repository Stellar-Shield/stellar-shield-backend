import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

/**
 * The three ways this backend could not answer a request.
 *
 * Every test here fails against the code as it was. They are grouped by the
 * thing that was broken rather than by file, because each one took down a whole
 * endpoint rather than a branch inside it.
 */

const GUARD = 'CDHAOCU3SQ5FJK3K2TT76T74V7SYEQUN6GU2EXX3A7BZR7XYVPYUMB5T';
const USER = 'GDTL6PQJ2NVDW3HVTFIOBVXIWHCKSOEPWWSYT67QVKJLNFDOWNGCJ3U6';

/**
 * A test must not read the developer's .env.
 *
 * `dotenv.config()` is called at module scope in soroban.ts and redis.ts, so a
 * .env sitting in the repo put GUARD_CONTRACT_ID back after a test deleted it,
 * and the "unset contract id" cases passed here and failed on a machine that
 * had one. The environment a test describes has to be the environment it runs
 * in, so dotenv is stubbed out entirely.
 */
vi.mock('dotenv', () => ({ default: { config: () => ({ parsed: {} }) }, config: () => ({ parsed: {} }) }));

/** Capture the transaction the code builds, and answer the simulation. */
let built: unknown = null;

vi.mock('@stellar/stellar-sdk', async () => {
  const actual = await vi.importActual<typeof import('@stellar/stellar-sdk')>(
    '@stellar/stellar-sdk',
  );
  class FakeRpcServer {
    async simulateTransaction(tx: unknown) {
      // Reached only if the envelope encoded. That is the point of the test.
      built = tx;
      return { result: { retval: actual.nativeToScVal(100n, { type: 'i128' }) } };
    }
    async getAccount() {
      throw new Error('a read must not need a network round trip for its source account');
    }
  }
  return {
    ...actual,
    rpc: { ...actual.rpc, Server: FakeRpcServer },
    Horizon: { ...actual.Horizon, Server: class {} },
  };
});

beforeEach(() => {
  built = null;
  delete process.env.REDIS_URL;
  delete process.env.VERCEL;
  process.env.GUARD_CONTRACT_ID = GUARD;
  process.env.REGISTRY_CONTRACT_ID = GUARD;
  vi.resetModules();
});

afterEach(() => vi.resetModules());

describe('the account a read is simulated against', () => {
  it('encodes, so the read reaches the network at all', async () => {
    const { getVelocityState } = await import('../src/lib/soroban');

    // The old source was 55 characters where a Stellar public key is 56. It
    // was rejected, the rejection was swallowed, and the stub that replaced it
    // carried the same bad id -- so the envelope failed to encode and every
    // call to this function threw `invalid encoded string`.
    await expect(getVelocityState(USER)).resolves.toMatchObject({
      limitStroops: '100',
      guarded: true,
    });
    expect(built).not.toBeNull();
  });

  it('is a valid Stellar public key', async () => {
    const { StrKey, Account } = await import('@stellar/stellar-sdk');
    const source = (built ?? null) as { source?: string } | null;
    // Belt and braces: assert the literal itself, independent of the call above.
    const { SIMULATION_SOURCE } = await import('../src/lib/soroban');
    expect(SIMULATION_SOURCE).toHaveLength(56);
    expect(StrKey.isValidEd25519PublicKey(SIMULATION_SOURCE)).toBe(true);
    expect(() => new Account(SIMULATION_SOURCE, '0')).not.toThrow();
    expect(source).not.toBeUndefined();
  });
});

describe('an unset contract id', () => {
  it('names the variable instead of throwing from inside the SDK', async () => {
    delete process.env.GUARD_CONTRACT_ID;
    const { contractId } = await import('../src/lib/soroban');
    expect(() => contractId('guard')).toThrow(/GUARD_CONTRACT_ID is not set/);
  });
});

describe('the cache', () => {
  it('is absent rather than fatal when REDIS_URL is unset', async () => {
    const { getCachedEvents, cacheEvents } = await import('../src/lib/redis');

    // These used to be awaited against redis://localhost:6379 before any real
    // work happened, so on a host with no local Redis the cache lookup for a
    // read that needs no cache was what failed the request.
    await expect(cacheEvents('k', { a: 1 })).resolves.toBeUndefined();
    await expect(getCachedEvents('k')).resolves.toBeNull();
  });
});

describe('the challenge store', () => {
  it('reports itself unavailable with no shared store, and says why', async () => {
    const { challengeStoreStatus } = await import('../src/lib/redis');
    const status = challengeStoreStatus();
    expect(status.available).toBe(false);
    expect(status.reason).toMatch(/REDIS_URL/);
  });

  it('refuses instead of accepting a challenge it cannot make single-use', async () => {
    const { setChallenge, popChallenge } = await import('../src/lib/redis');
    await expect(setChallenge('u', 'c')).rejects.toThrow(/REDIS_URL/);
    await expect(popChallenge('u')).rejects.toThrow(/REDIS_URL/);
  });

  it('points at the deployment when it is running serverless', async () => {
    process.env.VERCEL = '1';
    vi.resetModules();
    const { challengeStoreStatus } = await import('../src/lib/redis');
    expect(challengeStoreStatus().reason).toMatch(/Set REDIS_URL on this deployment/);
  });
});

describe('health', () => {
  it('is 503 when the contracts are not configured', async () => {
    delete process.env.GUARD_CONTRACT_ID;
    delete process.env.REGISTRY_CONTRACT_ID;
    vi.resetModules();
    const { createApp } = await import('../src/app');
    const app = createApp();

    // It used to answer 200 {"status":"StellarShield Online"} from a process
    // that could not serve a single real request.
    const res = await inject(app, 'GET', '/health');
    expect(res.status).toBe(503);
    expect(JSON.parse(res.body).status).toBe('not configured');
  });

  it('is 200 once guard and registry are set', async () => {
    const { createApp } = await import('../src/app');
    const res = await inject(createApp(), 'GET', '/health');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).contracts.guard).toBe(true);
  });
});

describe('auth without a challenge store', () => {
  it('answers 503 with a reason rather than a hung Redis connection', async () => {
    const { createApp } = await import('../src/app');
    const res = await inject(createApp(), 'POST', '/auth/challenge', { userId: 'u' });
    expect(res.status).toBe(503);
    expect(JSON.parse(res.body).error).toMatch(/challenge/i);
  });
});

/** Drive the Express app over a real socket, so the routing is exercised. */
async function inject(
  app: import('express').Express,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
  const { createServer } = await import('node:http');
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.text() };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
