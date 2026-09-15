import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';

import authRoutes from './routes/auth';
import guardRoutes from './routes/guard';
import registryRoutes from './routes/registry';
import txRoutes from './routes/tx';
import { CONTRACT_IDS } from './lib/soroban';
import { challengeStoreStatus } from './lib/redis';

dotenv.config();

/**
 * The Express app, built but not listening.
 *
 * `app.listen()` used to run at import time, which meant the app could only
 * ever be started as a long-lived process. A serverless platform imports the
 * module and calls the exported handler; an import that binds a port instead
 * either fails or holds the function open. The listen call now lives in
 * `server.ts`, which is what `npm start` runs, and `api/index.ts` exports this
 * app for Vercel. Both get the same routes.
 */
export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use('/auth', authRoutes);
  app.use('/guard', guardRoutes);
  app.use('/registry', registryRoutes);
  app.use('/tx', txRoutes);

  /**
   * Health says what is actually configured.
   *
   * It used to answer `{ status: 'StellarShield Online' }` unconditionally,
   * which was true of a process that could not answer a single real request —
   * no contract ids, no challenge store, every read failing. A health check
   * that cannot go wrong is not a health check.
   */
  app.get('/health', (_req, res) => {
    const store = challengeStoreStatus();
    const contracts = {
      guard: Boolean(CONTRACT_IDS.guard),
      registry: Boolean(CONTRACT_IDS.registry),
      auth: Boolean(CONTRACT_IDS.auth),
    };
    const ready = contracts.guard && contracts.registry;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'not configured',
      contracts,
      network: process.env.NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
      rpc: process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
      passkeys: store.available ? 'available' : 'unavailable',
      passkeysReason: store.reason,
    });
  });

  app.use((_req, res) => res.status(404).json({ error: 'No such route' }));

  return app;
}

export default createApp();
