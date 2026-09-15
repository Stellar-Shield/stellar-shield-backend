import { describe, expect, it } from "vitest";
import crypto from "node:crypto";

import { coseToUncompressed, derToCompact } from "../src/lib/webauthn";

/**
 * These use real P-256 keys and real signatures from node's crypto, not
 * hand-written fixtures. A hand-written fixture would only ever exercise the
 * shape I already believed in, and both bugs here were about shapes I had not.
 */
function p256() {
  return crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
}

describe("derToCompact", () => {
  it("converts a real DER signature to 64 raw bytes", () => {
    const { privateKey } = p256();
    const sig = crypto.sign("sha256", Buffer.from("hello"), privateKey);
    const compact = derToCompact(sig);
    expect(compact.length).toBe(64);
  });

  it("survives every signature, including short r or s", () => {
    // DER stores minimal integers, so roughly 1 in 256 signatures has a
    // component shorter than 32 bytes. The old code threw on those. Signing
    // many messages makes it near-certain we hit one.
    const { privateKey } = p256();
    let shortSeen = 0;
    for (let i = 0; i < 400; i++) {
      const sig = crypto.sign("sha256", Buffer.from(`m${i}`), privateKey);
      // r length lives at byte 3 of a two-INTEGER SEQUENCE.
      if (sig[3] < 32 || sig[3 + sig[3] + 2] < 32) shortSeen++;
      expect(derToCompact(sig).length).toBe(64);
    }
    expect(shortSeen).toBeGreaterThan(0);
  });

  it("produces a compact signature that still verifies", () => {
    // ECDSA is randomised, so two signatures over the same message differ.
    // Comparing against a second signature proves nothing; what matters is
    // that the converted bytes verify against the same key and message.
    const { privateKey, publicKey } = p256();
    for (let i = 0; i < 50; i++) {
      const msg = Buffer.from(`agreement ${i}`);
      const der = crypto.sign("sha256", msg, privateKey);
      const compact = derToCompact(der);
      expect(
        crypto.verify("sha256", msg, { key: publicKey, dsaEncoding: "ieee-p1363" }, compact),
      ).toBe(true);
    }
  });

  it("refuses input that is not a DER signature", () => {
    expect(() => derToCompact(Buffer.from([0x31, 0x00]))).toThrow(/SEQUENCE/);
    expect(() => derToCompact(Buffer.alloc(0))).toThrow();
  });
});

describe("coseToUncompressed", () => {
  /** A COSE_Key for P-256, encoded the way an authenticator really does. */
  function coseKey(x: Buffer, y: Buffer): Buffer {
    return Buffer.concat([
      Buffer.from([0xa5]), // map(5)
      Buffer.from([0x01, 0x02]), // 1 (kty): 2 (EC2)
      Buffer.from([0x03, 0x26]), // 3 (alg): -7 (ES256)
      Buffer.from([0x20, 0x01]), // -1 (crv): 1 (P-256)
      Buffer.from([0x21, 0x58, 0x20]), x, // -2 (x): bytes(32)
      Buffer.from([0x22, 0x58, 0x20]), y, // -3 (y): bytes(32)
    ]);
  }

  it("reads a 32-byte coordinate encoded as 0x58 0x20", () => {
    // This is the case the old parser could not read. It took the low five bits
    // of 0x58 as the length -- 24 -- and read 24 bytes from the wrong offset,
    // so it failed on every real authenticator key.
    const x = crypto.randomBytes(32);
    const y = crypto.randomBytes(32);
    const out = coseToUncompressed(coseKey(x, y));

    expect(out.length).toBe(65);
    expect(out[0]).toBe(0x04);
    expect(out.subarray(1, 33).toString("hex")).toBe(x.toString("hex"));
    expect(out.subarray(33).toString("hex")).toBe(y.toString("hex"));
  });

  it("produces a point node accepts as a public key", () => {
    const { publicKey } = p256();
    const raw = publicKey.export({ format: "jwk" });
    const x = Buffer.from(raw.x as string, "base64url");
    const y = Buffer.from(raw.y as string, "base64url");

    const out = coseToUncompressed(coseKey(x, y));
    const imported = crypto.createPublicKey({
      key: { kty: "EC", crv: "P-256", x: out.subarray(1, 33).toString("base64url"), y: out.subarray(33).toString("base64url") },
      format: "jwk",
    });
    expect(imported.asymmetricKeyType).toBe("ec");
  });

  it("says which coordinate is wrong rather than failing vaguely", () => {
    const short = Buffer.concat([
      Buffer.from([0xa2]),
      Buffer.from([0x21, 0x41]), crypto.randomBytes(1),
      Buffer.from([0x22, 0x41]), crypto.randomBytes(1),
    ]);
    expect(() => coseToUncompressed(short)).toThrow(/coordinates are 1\/1 bytes/);
  });
});
