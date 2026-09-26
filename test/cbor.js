/**
 * The smallest CBOR encoder that will do.
 *
 * Only the shapes a "none"-attestation registration needs are supported:
 * unsigned and negative integers, byte strings, text strings and maps.
 * Anything else throws, deliberately — this is a test fixture, not a library.
 */

function head(majorType, length) {
  const type = majorType << 5;
  if (length < 24) return Buffer.from([type | length]);
  if (length < 0x100) return Buffer.from([type | 24, length]);
  if (length < 0x10000) {
    const buffer = Buffer.alloc(3);
    buffer[0] = type | 25;
    buffer.writeUInt16BE(length, 1);
    return buffer;
  }
  const buffer = Buffer.alloc(5);
  buffer[0] = type | 26;
  buffer.writeUInt32BE(length, 1);
  return buffer;
}

export function encode(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value >= 0 ? head(0, value) : head(1, -value - 1);
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const bytes = Buffer.from(value);
    return Buffer.concat([head(2, bytes.length), bytes]);
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (value instanceof Map) {
    const parts = [head(5, value.size)];
    for (const [key, entry] of value) parts.push(encode(key), encode(entry));
    return Buffer.concat(parts);
  }
  throw new Error(`cbor.encode: unsupported value ${String(value)}`);
}
