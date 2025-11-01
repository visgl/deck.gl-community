/**
 * Converts a hexadecimal string (with or without “0x” prefix) to a bigint.
 * @param hex – The hex string representation (e.g., "0x1a2b", "FF", "00ff")
 * @returns The corresponding bigint value.
 * @throws {Error} If the input is not a valid hex string.
 */
export function hexToBigInt(hex: string): bigint {
  if (typeof hex !== 'string') {
    throw new Error(`hexToBigInt: expected string, got ${typeof hex}`);
  }

  let s = hex.trim();
  if (s.startsWith('0x') || s.startsWith('0X')) {
    s = s.slice(2);
  }

  if (s === '') {
    throw new Error(`hexToBigInt: empty hex string`);
  }

  // validate: only hex digits
  if (!/^[0-9A-Fa-f]+$/.test(s)) {
    throw new Error(`hexToBigInt: invalid hex string “${hex}”`);
  }

  // Optional: normalize even length by prepending a zero if odd
  if (s.length % 2 === 1) {
    s = '0' + s;
  }

  // Use BigInt conversion from string with 0x prefix
  try {
    return BigInt('0x' + s);
  } catch (e) {
    throw new Error(`hexToBigInt: cannot convert hex string “${hex}” to bigint: ${(e as Error).message}`);
  }
}
