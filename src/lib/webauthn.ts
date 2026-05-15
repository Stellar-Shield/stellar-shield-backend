/**
 * WebAuthn DER → compact r||s conversion.
 * WebAuthn returns ECDSA signatures in ASN.1 DER format.
 * AuthContract::verify_sig expects a raw 64-byte compact r||s buffer.
 */
export function derToCompact(der: Buffer): Buffer {
  let offset = 0;

  if (der[offset++] !== 0x30) throw new Error('Invalid DER: expected SEQUENCE');
  // Skip total length (may be 1 or 2 bytes)
  if (der[offset] & 0x80) offset += (der[offset] & 0x7f) + 1;
  else offset++;

  if (der[offset++] !== 0x02) throw new Error('Invalid DER: expected INTEGER for r');
  const rLen = der[offset++];
  let r = der.subarray(offset, offset + rLen);
  offset += rLen;

  if (der[offset++] !== 0x02) throw new Error('Invalid DER: expected INTEGER for s');
  const sLen = der[offset++];
  let s = der.subarray(offset, offset + sLen);

  // Strip ASN.1 sign-padding zero byte
  if (r.length === 33 && r[0] === 0x00) r = r.subarray(1);
  if (s.length === 33 && s[0] === 0x00) s = s.subarray(1);

  if (r.length !== 32 || s.length !== 32) {
    throw new Error(`Unexpected component length r=${r.length} s=${s.length}`);
  }

  return Buffer.concat([r, s]);
}

/**
 * Extracts the uncompressed 65-byte SEC1 public key (0x04 || x || y)
 * from a COSE-encoded WebAuthn credential public key (CBOR map).
 * Requires the caller to pass the raw CBOR bytes from the attestation.
 */
export function coseToUncompressed(coseKey: Buffer): Buffer {
  // COSE key map keys: 1=kty, 3=alg, -1=crv, -2=x, -3=y
  // Minimal CBOR parser for map with integer keys
  let offset = 0;
  const mapHeader = coseKey[offset++];
  const mapLen = mapHeader & 0x1f; // number of pairs

  const entries: Record<number, Buffer> = {};
  for (let i = 0; i < mapLen; i++) {
    const keyByte = coseKey[offset++];
    // Negative keys: 0x20 = -1, 0x21 = -2, 0x22 = -3
    const key = keyByte <= 0x17 ? keyByte : -(keyByte - 0x1f);
    const valHeader = coseKey[offset++];
    const valType = valHeader >> 5;
    const valLen = valHeader & 0x1f;
    if (valType === 2) {
      // byte string
      entries[key] = coseKey.subarray(offset, offset + valLen);
      offset += valLen;
    } else {
      // integer — skip
      offset++;
    }
  }

  const x = entries[-2];
  const y = entries[-3];
  if (!x || !y || x.length !== 32 || y.length !== 32) {
    throw new Error('Invalid COSE key: missing x or y coordinate');
  }

  return Buffer.concat([Buffer.from([0x04]), x, y]);
}
