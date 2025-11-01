import { describe, it, expect } from 'vitest';
import { hexToBigInt } from '../../src/global-grid-systems/utils/hex-utils';

describe('hexToBigInt', () => {
  it('should convert simple hex without prefix', () => {
    expect(hexToBigInt('ff')).toBe(0xffn);
    expect(hexToBigInt('FF')).toBe(0xFFn);
    expect(hexToBigInt('1a')).toBe(0x1an);
  });

  it('should convert hex with 0x prefix', () => {
    expect(hexToBigInt('0xFF')).toBe(0xFFn);
    expect(hexToBigInt('0X1a2b')).toBe(0x1a2bn);
  });

  it('should handle odd-length hex by zero-padding', () => {
    // e.g. "f" => "0f"
    expect(hexToBigInt('f')).toBe(0x0fn);
    expect(hexToBigInt('0xF')).toBe(0x0fn);
    expect(hexToBigInt('abc')).toBe(0x0abcn);
  });

  it('should handle large hex values (bigger than Number.MAX_SAFE_INTEGER)', () => {
    const bigHex = '123456789ABCDEF123456789ABCDEF';
    const expected = BigInt('0x' + bigHex);
    expect(hexToBigInt(bigHex)).toBe(expected);
    expect(hexToBigInt('0x' + bigHex)).toBe(expected);
  });

  it('should throw on invalid input types or strings', () => {
    // @ts-expect-error testing wrong type
    expect(() => hexToBigInt((123 as any))).toThrow();
    expect(() => hexToBigInt('')).toThrow();
    expect(() => hexToBigInt('0x')).toThrow();
    expect(() => hexToBigInt('0xGHI')).toThrow();
    expect(() => hexToBigInt('xyz')).toThrow();
  });

  it('should preserve sign when using BigInt (only positive in this implementation)', () => {
    // This implementation treats any hex as unsigned: e.g., "FF" -> 255n
    expect(hexToBigInt('FF')).toBe(255n);
  });
});
