/**
 * WebAuthn signature and key conversion.
 *
 * WebAuthn hands back ECDSA signatures in ASN.1 DER and public keys in COSE
 * CBOR. The AuthContract wants 64 raw bytes of r||s and a 65-byte uncompressed
 * SEC1 point. Both conversions are fiddly in ways that fail rarely, which is
 * the worst frequency: often enough to happen to users, rarely enough to look
 * like a flake.
 */

/** Left-pad a big-endian integer to exactly 32 bytes. */
function to32(component: Buffer, which: string): Buffer {
  // DER stores a minimal integer, so a value whose top byte is below 0x80 and
  // whose leading bytes are zero comes back SHORTER than 32 bytes. That happens
  // for roughly one signature in 256 per component. The previous version threw
  // on anything that was not 32 or a 33-byte padded form, so those signatures
  // were rejected as malformed when they were perfectly valid.
  if (component.length > 32) {
    throw new Error(`DER ${which} is ${component.length} bytes, longer than a P-256 scalar`);
  }
  if (component.length === 32) return component;
  const out = Buffer.alloc(32);
  component.copy(out, 32 - component.length);
  return out;
}

/** Read a DER length at `offset`, returning the value and the new offset. */
function readLength(der: Buffer, offset: number): [number, number] {
  const first = der[offset++];
  if ((first & 0x80) === 0) return [first, offset];
  const n = first & 0x7f;
  if (n === 0 || n > 4) throw new Error('Invalid DER: unsupported length form');
  let len = 0;
  for (let i = 0; i < n; i++) len = (len << 8) | der[offset++];
  return [len, offset];
}

export function derToCompact(der: Buffer): Buffer {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error('Invalid DER: expected SEQUENCE');
  [, offset] = readLength(der, offset);

  if (der[offset++] !== 0x02) throw new Error('Invalid DER: expected INTEGER for r');
  let rLen: number;
  [rLen, offset] = readLength(der, offset);
  let r = der.subarray(offset, offset + rLen);
  offset += rLen;

  if (der[offset++] !== 0x02) throw new Error('Invalid DER: expected INTEGER for s');
  let sLen: number;
  [sLen, offset] = readLength(der, offset);
  let s = der.subarray(offset, offset + sLen);

  // ASN.1 prepends a zero byte when the top bit would otherwise read as a sign.
  if (r.length === 33 && r[0] === 0x00) r = r.subarray(1);
  if (s.length === 33 && s[0] === 0x00) s = s.subarray(1);

  return Buffer.concat([to32(r, 'r'), to32(s, 's')]);
}

/** Read one CBOR item header: returns [majorType, value, newOffset]. */
function readHeader(buf: Buffer, offset: number): [number, number, number] {
  const b = buf[offset++];
  const major = b >> 5;
  const info = b & 0x1f;
  if (info < 24) return [major, info, offset];
  if (info === 24) return [major, buf[offset++], offset];
  if (info === 25) return [major, buf.readUInt16BE(offset), offset + 2];
  if (info === 26) return [major, buf.readUInt32BE(offset), offset + 4];
  throw new Error('Invalid COSE key: unsupported CBOR length');
}

/**
 * COSE EC2 key to the 65-byte uncompressed SEC1 point the contract stores.
 *
 * The previous version read a byte-string length out of the low five bits of
 * the header alone. A 32-byte string is encoded as 0x58 0x20 -- five bits of
 * 24, meaning "length follows in the next byte". So it read 24 bytes from the
 * wrong offset and then rejected the key for having the wrong coordinate
 * length. Since P-256 coordinates are always 32 bytes, that meant it failed on
 * every real key.
 */
export function coseToUncompressed(coseKey: Buffer): Buffer {
  let offset = 0;
  const [major, pairs, afterMap] = readHeader(coseKey, offset);
  if (major !== 5) throw new Error('Invalid COSE key: expected a CBOR map');
  offset = afterMap;

  const entries: Record<number, Buffer> = {};
  for (let i = 0; i < pairs; i++) {
    const [keyMajor, keyVal, afterKey] = readHeader(coseKey, offset);
    offset = afterKey;
    // Major 0 is a non-negative integer, major 1 is a negative one encoded as
    // -1 - value, which is how COSE spells -1, -2 and -3 for crv, x and y.
    const key = keyMajor === 1 ? -1 - keyVal : keyVal;

    const [valMajor, valLen, afterVal] = readHeader(coseKey, offset);
    offset = afterVal;
    if (valMajor === 2) {
      entries[key] = coseKey.subarray(offset, offset + valLen);
      offset += valLen;
    } else if (valMajor === 3) {
      offset += valLen; // text string, skipped
    }
    // integers carry their value in the header, so there is nothing to skip
  }

  const x = entries[-2];
  const y = entries[-3];
  if (!x || !y) throw new Error('Invalid COSE key: missing x or y coordinate');
  if (x.length !== 32 || y.length !== 32) {
    throw new Error(`Invalid COSE key: coordinates are ${x.length}/${y.length} bytes, expected 32`);
  }

  return Buffer.concat([Buffer.from([0x04]), x, y]);
}
