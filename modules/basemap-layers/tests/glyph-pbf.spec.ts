/* eslint-disable import/no-extraneous-dependencies */
import {readFileSync} from 'node:fs';
import {describe, expect, test} from 'vitest';
import {GLYPH_BORDER, parseGlyphRange} from '../src/glyph-pbf.ts';

const NOTO_SANS = new URL(
  './reference-render/fixtures/tiles.openfreemap.org/fonts/Noto Sans Regular/',
  import.meta.url
);

/** A protocol buffer varint. */
function varint(value: number): number[] {
  const bytes: number[] = [];
  while (value >= 0x80) {
    bytes.push((value % 0x80) + 0x80);
    value = Math.floor(value / 0x80);
  }
  bytes.push(value);
  return bytes;
}

function field(tag: number, wireType: number, payload: number[]): number[] {
  const key = varint(tag * 8 + wireType);
  return wireType === 2 ? [...key, ...varint(payload.length), ...payload] : [...key, ...payload];
}

const zigzag = (value: number) => (value < 0 ? -2 * value - 1 : 2 * value);

/** A glyph range of one font stack holding `glyphs`, each a list of encoded fields. */
function glyphRange(glyphs: number[][]): Uint8Array {
  const fontstack = [
    ...field(1, 2, [...new TextEncoder().encode('Test Regular')]),
    ...field(2, 2, [...new TextEncoder().encode('0-255')]),
    ...glyphs.flatMap(glyph => field(3, 2, glyph))
  ];
  return new Uint8Array(field(1, 2, fontstack));
}

function glyph({
  id,
  width,
  height,
  left = 0,
  top = 0,
  advance = width,
  bitmapLength = width && height ? (width + 6) * (height + 6) : 0
}: {
  id: number;
  width: number;
  height: number;
  left?: number;
  top?: number;
  advance?: number;
  bitmapLength?: number;
}): number[] {
  return [
    ...field(1, 0, varint(id)),
    ...(bitmapLength ? field(2, 2, new Array(bitmapLength).fill(128)) : []),
    ...field(3, 0, varint(width)),
    ...field(4, 0, varint(height)),
    ...field(5, 0, varint(zigzag(left))),
    ...field(6, 0, varint(zigzag(top))),
    ...field(7, 0, varint(advance))
  ];
}

describe('parseGlyphRange', () => {
  test('reads the glyphs of a recorded range with their metrics, as MapLibre GL JS reads them', () => {
    const glyphs = parseGlyphRange(readFileSync(new URL('0-255.pbf', NOTO_SANS)));
    const a = glyphs.find(({id}) => id === 65)!;
    expect({...a, bitmap: a.bitmap.length}).toEqual({
      id: 65,
      bitmap: (15 + 2 * GLYPH_BORDER) * (17 + 2 * GLYPH_BORDER),
      width: 15,
      height: 17,
      left: 0,
      top: -9,
      advance: 15
    });
    // A space has an advance and no ink.
    const space = glyphs.find(({id}) => id === 32)!;
    expect(space.bitmap.length).toBe(0);
    expect(space.advance).toBeGreaterThan(0);
  });

  test('reads negative bearings and multi-byte values', () => {
    const [read] = parseGlyphRange(
      glyphRange([
        glyph({
          id: 300,
          width: 2,
          height: 3,
          left: -2,
          top: -20,
          advance: 200
        })
      ])
    );
    expect({...read, bitmap: read.bitmap.length}).toEqual({
      id: 300,
      bitmap: 8 * 9,
      width: 2,
      height: 3,
      left: -2,
      top: -20,
      advance: 200
    });
  });

  test('skips a glyph whose bitmap does not match its size', () => {
    const glyphs = parseGlyphRange(
      glyphRange([
        glyph({id: 65, width: 2, height: 2, bitmapLength: 10}),
        glyph({id: 66, width: 2, height: 2})
      ])
    );
    expect(glyphs.map(({id}) => id)).toEqual([66]);
  });

  test('skips fields it does not know', () => {
    const unknown = [
      ...field(9, 0, varint(7)),
      ...field(10, 2, [1, 2, 3]),
      ...field(11, 5, [0, 0, 0, 0])
    ];
    const glyphs = parseGlyphRange(
      glyphRange([[...unknown, ...glyph({id: 65, width: 1, height: 1})]])
    );
    expect(glyphs.map(({id}) => id)).toEqual([65]);
  });

  test('rejects a truncated range', () => {
    const range = glyphRange([glyph({id: 65, width: 2, height: 2})]);
    expect(() => parseGlyphRange(range.subarray(0, range.length - 5))).toThrow(/Truncated/);
  });
});
