import { Router, Request, Response } from 'express';
import { isTrustedDrip, fetchContractEvents, CONTRACT_IDS } from '../lib/soroban';
import { getCachedEvents, cacheEvents } from '../lib/redis';

const router = Router();

/**
 * GET /registry/drips?address=<stellar_address>
 * Checks whether a single address is a trusted drip in RegistryContract.
 */
router.get('/drips', async (req: Request, res: Response) => {
  const address = req.query.address as string | undefined;
  if (!address) return res.status(400).json({ error: 'address query param required' });

  try {
    const trusted = await isTrustedDrip(address);
    return res.json({ address, trusted });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /registry/events?startLedger=<number>
 * Returns recent add_trusted_drip events from RegistryContract.
 * Cached for 60 s.
 */
router.get('/events', async (req: Request, res: Response) => {
  const startLedger = parseInt(req.query.startLedger as string, 10) || 0;
  const cacheKey = `registry-events:${startLedger}`;

  const cached = await getCachedEvents(cacheKey);
  if (cached) return res.json({ events: cached, cached: true });

  try {
    const events = await fetchContractEvents(CONTRACT_IDS.registry, startLedger);
    await cacheEvents(cacheKey, events);
    return res.json({ events });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
