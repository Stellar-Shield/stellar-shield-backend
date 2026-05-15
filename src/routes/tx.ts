import { Router, Request, Response } from 'express';
import { relayXDR } from '../lib/soroban';

const router = Router();

/**
 * POST /tx/relay
 * Body: { xdr: string }  — fully signed XDR transaction envelope (base64)
 * Submits to Soroban RPC and returns the network response.
 */
router.post('/relay', async (req: Request, res: Response) => {
  const { xdr } = req.body as { xdr?: string };
  if (!xdr) return res.status(400).json({ error: 'xdr required' });

  try {
    const result = await relayXDR(xdr);
    return res.json({ success: true, result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Transaction relay failed' });
  }
});

export default router;
