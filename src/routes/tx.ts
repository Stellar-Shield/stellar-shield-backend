import { Router, Request, Response } from 'express';
import { relayXDR } from '../lib/soroban';

const router = Router();

/**
 * POST /tx/relay
 * Body: { xdr: string }  — fully signed XDR transaction envelope (base64)
 * Submits to Soroban RPC and returns the network response.
 */
router.post('/relay', async (req: Request, res: Response) => {
  // The frontend sent `signedXdr` and this route read `xdr`, so every relay
  // was answered with a 400. Both spellings are accepted now, and the name is
  // written down in API.md so the next one does not drift.
  const body = req.body as { xdr?: string; signedXdr?: string };
  const xdr = body.xdr ?? body.signedXdr;
  if (!xdr) return res.status(400).json({ error: 'xdr (or signedXdr) required' });

  try {
    const result = await relayXDR(xdr);
    return res.json({ success: true, result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Transaction relay failed' });
  }
});

export default router;
