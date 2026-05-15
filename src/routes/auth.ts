import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { derToCompact, coseToUncompressed } from '../lib/webauthn';
import { setChallenge, popChallenge } from '../lib/redis';

const router = Router();

/**
 * POST /auth/challenge
 * Body: { userId: string }
 * Returns a fresh random challenge for the client to sign with WebAuthn.
 */
router.post('/challenge', async (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const challenge = crypto.randomBytes(32).toString('base64url');
  await setChallenge(userId, challenge);
  return res.json({ challenge });
});

/**
 * POST /auth/verify
 * Body: { userId, derSignature (hex), cosePublicKey? (hex) }
 *
 * Converts the DER signature to compact r||s (64 bytes) ready for
 * AuthContract::verify_sig. Optionally converts a COSE public key to
 * the 65-byte uncompressed SEC1 format expected by AuthContract::register_key.
 */
router.post('/verify', async (req: Request, res: Response) => {
  const { userId, derSignature, cosePublicKey } = req.body as {
    userId?: string;
    derSignature?: string;
    cosePublicKey?: string;
  };

  if (!userId || !derSignature) {
    return res.status(400).json({ error: 'userId and derSignature required' });
  }

  const challenge = await popChallenge(userId);
  if (!challenge) {
    return res.status(400).json({ error: 'No pending challenge for this user (expired or already used)' });
  }

  try {
    const compact = derToCompact(Buffer.from(derSignature, 'hex'));
    const result: Record<string, string> = {
      challenge,
      compactSignature: compact.toString('hex'),
    };

    if (cosePublicKey) {
      const uncompressed = coseToUncompressed(Buffer.from(cosePublicKey, 'hex'));
      result.uncompressedPublicKey = uncompressed.toString('hex');
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

export default router;
