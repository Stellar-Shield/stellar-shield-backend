import { Router, Request, Response } from 'express';
import { getVelocityState } from '../lib/soroban';
import { getCachedEvents, cacheEvents } from '../lib/redis';

const router = Router();

/**
 * GET /guard/velocity?user=<stellar_address>
 * Returns the user's current daily spend state from GuardContract.
 * Results are cached in Redis for 60 s to avoid hammering Soroban RPC.
 */
router.get('/velocity', async (req: Request, res: Response) => {
  const user = req.query.user as string | undefined;
  if (!user) return res.status(400).json({ error: 'user query param required' });

  const cacheKey = `velocity:${user}`;
  const cached = await getCachedEvents(cacheKey);
  if (cached) return res.json({ ...cached as object, cached: true });

  try {
    const state = await getVelocityState(user);
    await cacheEvents(cacheKey, state);
    return res.json(state);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
