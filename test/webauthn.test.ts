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

  it("survives every signature real signing produces", () => {
    const { privateKey } = p256();
    for (let i = 0; i < 400; i++) {
      expect(derToCompact(crypto.sign("sha256", Buffer.from(`m${i}`), privateKey)).length).toBe(64);
    }
  });

  /**
   * The short-component case is built, not waited for.
   *
   * This used to sign 400 messages and assert that at least one had a
   * component under 32 bytes. That is about a 1-in-130 event per signature, so
   * the assertion held roughly 96 times in 100 -- and failed the other four,
   * which is exactly what it did in CI. A test that fails one run in twenty
   * teaches people to re-run CI instead of reading it. The encoding is what is
   * under test, and an encoding can be written down.
   */
  it("left-pads a short component instead of throwing", () => {
    const r = Buffer.concat([Buffer.from([0x01]), Buffer.alloc(30, 0xab)]); // 31 bytes
    const s = Buffer.concat([Buffer.from([0x7f]), Buffer.alloc(31, 0xcd)]); // 32 bytes
    const der = Buffer.concat([
      Buffer.from([0x30, 4 + r.length + s.length, 0x02, r.length]),
      r,
      Buffer.from([0x02, s.length]),
      s,
    ]);

    const compact = derToCompact(der);
    expect(compact.length).toBe(64);
    expect(compact.subarray(0, 32)).toEqual(Buffer.concat([Buffer.alloc(1), r]));
    expect(compact.subarray(32)).toEqual(s);
  });

  it("rejects a component longer than a P-256 scalar", () => {
    const big = Buffer.alloc(33, 0xff);
    const der = Buffer.concat([
      Buffer.from([0x30, 4 + big.length * 2, 0x02, big.length]),
      big,
      Buffer.from([0x02, big.length]),
      big,
    ]);
    expect(() => derToCompact(der)).toThrow(/longer than a P-256 scalar/);
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
