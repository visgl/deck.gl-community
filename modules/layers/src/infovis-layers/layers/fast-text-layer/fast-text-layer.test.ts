import * as arrow from 'apache-arrow';
import {describe, expect, it} from 'vitest';

import {
  buildFastTextGlyphData,
  buildFastTextUtf8ColumnSource,
  collectFastTextCharacterSet,
  FAST_TEXT_GLYPH_VERTEX_BYTE_STRIDE,
  updateFastTextDynamicGlyphAttributes
} from './fast-text-layout';
import {DEFAULT_FAST_TEXT_FONT_SETTINGS} from './font-atlas';

import type {FastTextCharacterMapping} from './font-atlas';
import type {Position} from '@deck.gl/core';

type TestDatum = {
  readonly text: string;
  readonly position: Position;
};

const TEST_MAPPING: FastTextCharacterMapping = {
  A: {
    x: 0,
    y: 0,
    width: 10,
    height: 20,
    anchorX: 5,
    anchorY: 15,
    advance: 12
  },
  B: {
    x: 10,
    y: 0,
    width: 8,
    height: 20,
    anchorX: 4,
    anchorY: 15,
    advance: 9
  }
};

describe('FastTextLayer glyph expansion', () => {
  it('uses SDF atlas generation by default', () => {
    expect(DEFAULT_FAST_TEXT_FONT_SETTINGS.sdf).toBe(true);
  });

  it('builds packed glyph attributes for single-line labels', () => {
    const glyphData = buildFastTextGlyphData({
      data: [{text: 'AB', position: [1, 2, 3]}] satisfies TestDatum[],
      getText: datum => datum.text,
      singleLine: true,
      getPosition: datum => datum.position,
      getColor: [10, 20, 30, 200],
      textAnchor: 'start',
      alignmentBaseline: 'top',
      getClipRect: [0, -1, 10, 2],
      mapping: TEST_MAPPING,
      baselineOffset: 5,
      fontSize: 20,
      lineHeight: 1
    });

    expect(glyphData.length).toBe(2);
    expect(Array.from(glyphData.startIndices)).toEqual([0, 2]);
    expect(Array.from(glyphData.attributes.instancePositions)).toEqual([1, 2, 1, 2]);
    expect(readGlyphOffsets(glyphData.attributes.instanceGlyphData, glyphData.length)).toEqual([
      0, 0, 12, 0
    ]);
    expect(readGlyphFrames(glyphData.attributes.instanceGlyphData, glyphData.length)).toEqual([
      0, 0, 10, 20, 10, 0, 8, 20
    ]);
    expect(readGlyphClipRects(glyphData.attributes.instanceGlyphData, glyphData.length)).toEqual([
      0, -1, 10, 2, 0, -1, 10, 2
    ]);
    expect(readGlyphColors(glyphData.attributes.instanceGlyphData, glyphData.length)).toEqual([
      10, 20, 30, 200, 10, 20, 30, 200
    ]);
  });

  it('keeps positive fractional clip dimensions visible after int16 packing', () => {
    const glyphData = buildFastTextGlyphData({
      data: [{text: 'A', position: [1, 2, 3]}] satisfies TestDatum[],
      getText: datum => datum.text,
      singleLine: true,
      getPosition: datum => datum.position,
      getColor: [10, 20, 30, 200],
      textAnchor: 'start',
      alignmentBaseline: 'top',
      getClipRect: [0, -1, 0.25, 0.25],
      mapping: TEST_MAPPING,
      baselineOffset: 5,
      fontSize: 20,
      lineHeight: 1
    });

    expect(readGlyphClipRects(glyphData.attributes.instanceGlyphData, glyphData.length)).toEqual([
      0, -1, 1, 1
    ]);
  });

  it('applies horizontal and vertical alignment in atlas pixels', () => {
    const glyphData = buildFastTextGlyphData({
      data: [{text: 'AB', position: [0, 0]}] satisfies TestDatum[],
      getText: datum => datum.text,
      singleLine: true,
      getPosition: datum => datum.position,
      getColor: [0, 0, 0, 255],
      textAnchor: 'middle',
      alignmentBaseline: 'center',
      getClipRect: [0, 0, -1, -1],
      mapping: TEST_MAPPING,
      baselineOffset: 5,
      fontSize: 20,
      lineHeight: 1
    });

    expect(readGlyphOffsets(glyphData.attributes.instanceGlyphData, glyphData.length)).toEqual([
      -10, -10, 2, -10
    ]);
  });

  it('advances missing characters with zero-size glyph records', () => {
    const glyphData = buildFastTextGlyphData({
      data: [{text: 'A?B', position: [0, 0]}] satisfies TestDatum[],
      getText: datum => datum.text,
      singleLine: true,
      getPosition: datum => datum.position,
      getColor: [0, 0, 0, 255],
      textAnchor: 'start',
      alignmentBaseline: 'top',
      getClipRect: [0, 0, -1, -1],
      mapping: TEST_MAPPING,
      baselineOffset: 5,
      fontSize: 20,
      lineHeight: 1
    });

    expect(glyphData.length).toBe(3);
    expect(readGlyphOffsets(glyphData.attributes.instanceGlyphData, glyphData.length)).toEqual([
      0, 0, 12, 15, 44, 0
    ]);
    expect(readGlyphFrames(glyphData.attributes.instanceGlyphData, glyphData.length)).toEqual([
      0, 0, 10, 20, 0, 0, 0, 0, 10, 0, 8, 20
    ]);
    expect(Array.from(glyphData.characterSet).sort()).toEqual(['?', 'A', 'B']);
  });

  it('builds glyphs from a UTF-8 column without calling getText', () => {
    const column = buildFastTextUtf8ColumnSource(arrow.vectorFromArray(['AB'], new arrow.Utf8()));
    if (!column) {
      throw new Error('Expected test Utf8 column to expose direct buffers');
    }

    const glyphData = buildFastTextGlyphData({
      data: [{position: [1, 2, 3]}] satisfies Pick<TestDatum, 'position'>[],
      textUtf8Column: column,
      getTextUtf8Row: 0,
      getText: () => {
        throw new Error('getText should not be called for UTF-8 column mode');
      },
      singleLine: true,
      getPosition: datum => datum.position,
      getColor: [10, 20, 30, 200],
      textAnchor: 'start',
      alignmentBaseline: 'top',
      getClipRect: [0, -1, 10, 2],
      mapping: TEST_MAPPING,
      baselineOffset: 5,
      fontSize: 20,
      lineHeight: 1
    });

    expect(glyphData.length).toBe(2);
    expect(readGlyphOffsets(glyphData.attributes.instanceGlyphData, glyphData.length)).toEqual([
      0, 0, 12, 0
    ]);
    expect(readGlyphFrames(glyphData.attributes.instanceGlyphData, glyphData.length)).toEqual([
      0, 0, 10, 20, 10, 0, 8, 20
    ]);
    expect(Array.from(glyphData.characterSet)).toEqual([]);
  });

  it('builds glyphs from a reused UTF-8 view without calling getText', () => {
    const bytes = new Uint8Array([65, 66]);
    const glyphData = buildFastTextGlyphData({
      data: [{position: [1, 2, 3]}] satisfies Pick<TestDatum, 'position'>[],
      getTextUtf8: (_datum, out) => {
        out.data = bytes;
        out.start = 0;
        out.end = bytes.length;
        return true;
      },
      getText: () => {
        throw new Error('getText should not be called for UTF-8 view mode');
      },
      singleLine: true,
      getPosition: datum => datum.position,
      getColor: [10, 20, 30, 200],
      textAnchor: 'start',
      alignmentBaseline: 'top',
      getClipRect: [0, -1, 10, 2],
      mapping: TEST_MAPPING,
      baselineOffset: 5,
      fontSize: 20,
      lineHeight: 1
    });

    expect(glyphData.length).toBe(2);
    expect(readGlyphOffsets(glyphData.attributes.instanceGlyphData, glyphData.length)).toEqual([
      0, 0, 12, 0
    ]);
    expect(Array.from(glyphData.characterSet)).toEqual([]);
  });

  it('does not treat newline bytes specially in single-line UTF-8 column mode', () => {
    const column = buildFastTextUtf8ColumnSource(arrow.vectorFromArray(['A\nB'], new arrow.Utf8()));
    if (!column) {
      throw new Error('Expected test Utf8 column to expose direct buffers');
    }

    const glyphData = buildFastTextGlyphData({
      data: [{position: [0, 0]}] satisfies Pick<TestDatum, 'position'>[],
      textUtf8Column: column,
      getTextUtf8Row: 0,
      getText: () => {
        throw new Error('getText should not be called for UTF-8 column mode');
      },
      singleLine: true,
      getPosition: datum => datum.position,
      getColor: [0, 0, 0, 255],
      textAnchor: 'start',
      alignmentBaseline: 'top',
      getClipRect: [0, 0, -1, -1],
      mapping: TEST_MAPPING,
      baselineOffset: 5,
      fontSize: 20,
      lineHeight: 1
    });

    expect(glyphData.length).toBe(3);
    expect(readGlyphOffsets(glyphData.attributes.instanceGlyphData, glyphData.length)).toEqual([
      0, 0, 12, 15, 44, 0
    ]);
  });

  it('collects characters for auto atlas generation without newline entries', () => {
    const characterSet = collectFastTextCharacterSet({
      data: [{text: 'A\nB'}],
      getText: datum => datum.text
    });

    expect(Array.from(characterSet).sort()).toEqual(['A', 'B']);
  });

  it('rewrites dynamic positions and clip rects without changing glyph layout or colors', () => {
    const glyphData = buildFastTextGlyphData({
      data: [{text: 'AB', position: [1, 2, 3]}] satisfies TestDatum[],
      getText: datum => datum.text,
      singleLine: true,
      getPosition: datum => datum.position,
      getColor: [10, 20, 30, 200],
      textAnchor: 'start',
      alignmentBaseline: 'top',
      getClipRect: [0, -1, 10, 2],
      mapping: TEST_MAPPING,
      baselineOffset: 5,
      fontSize: 20,
      lineHeight: 1
    });
    const previousGlyphData = new Uint8Array(glyphData.attributes.instanceGlyphData);

    const stats = updateFastTextDynamicGlyphAttributes({
      data: [{text: 'AB', position: [5, 6, 7]}] satisfies TestDatum[],
      glyphData,
      getPosition: datum => datum.position,
      getColor: () => {
        throw new Error('getColor should not be called when colors are unchanged');
      },
      getClipRect: [3, -2, 4, 5],
      updatePositions: true,
      updateColors: false,
      updateClipRects: true
    });

    expect(stats.rowCount).toBe(1);
    expect(stats.glyphCount).toBe(2);
    expect(Array.from(glyphData.attributes.instancePositions)).toEqual([5, 6, 5, 6]);
    expect(readGlyphOffsets(glyphData.attributes.instanceGlyphData, glyphData.length)).toEqual([
      0, 0, 12, 0
    ]);
    expect(readGlyphFrames(glyphData.attributes.instanceGlyphData, glyphData.length)).toEqual([
      0, 0, 10, 20, 10, 0, 8, 20
    ]);
    expect(readGlyphClipRects(glyphData.attributes.instanceGlyphData, glyphData.length)).toEqual([
      3, -2, 4, 5, 3, -2, 4, 5
    ]);
    expect(readGlyphColors(glyphData.attributes.instanceGlyphData, glyphData.length)).toEqual([
      10, 20, 30, 200, 10, 20, 30, 200
    ]);
    expect(readGlyphOffsets(previousGlyphData, glyphData.length)).toEqual([0, 0, 12, 0]);
  });
});

function readGlyphOffsets(instanceGlyphData: Uint8Array, glyphCount: number): number[] {
  const int16Values = new Int16Array(instanceGlyphData.buffer);
  const offsets: number[] = [];
  for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex++) {
    const recordInt16Index =
      (glyphIndex * FAST_TEXT_GLYPH_VERTEX_BYTE_STRIDE) / Int16Array.BYTES_PER_ELEMENT;
    offsets.push(int16Values[recordInt16Index], int16Values[recordInt16Index + 1]);
  }
  return offsets;
}

function readGlyphFrames(instanceGlyphData: Uint8Array, glyphCount: number): number[] {
  const uint16Values = new Uint16Array(instanceGlyphData.buffer);
  const frames: number[] = [];
  for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex++) {
    const recordInt16Index =
      (glyphIndex * FAST_TEXT_GLYPH_VERTEX_BYTE_STRIDE) / Int16Array.BYTES_PER_ELEMENT;
    frames.push(
      uint16Values[recordInt16Index + 2],
      uint16Values[recordInt16Index + 3],
      uint16Values[recordInt16Index + 4],
      uint16Values[recordInt16Index + 5]
    );
  }
  return frames;
}

function readGlyphClipRects(instanceGlyphData: Uint8Array, glyphCount: number): number[] {
  const int16Values = new Int16Array(instanceGlyphData.buffer);
  const clipRects: number[] = [];
  for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex++) {
    const recordInt16Index =
      (glyphIndex * FAST_TEXT_GLYPH_VERTEX_BYTE_STRIDE) / Int16Array.BYTES_PER_ELEMENT;
    clipRects.push(
      int16Values[recordInt16Index + 6],
      int16Values[recordInt16Index + 7],
      int16Values[recordInt16Index + 8],
      int16Values[recordInt16Index + 9]
    );
  }
  return clipRects;
}

function readGlyphColors(instanceGlyphData: Uint8Array, glyphCount: number): number[] {
  const colors: number[] = [];
  for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex++) {
    const recordByteIndex = glyphIndex * FAST_TEXT_GLYPH_VERTEX_BYTE_STRIDE;
    colors.push(
      instanceGlyphData[recordByteIndex + Int16Array.BYTES_PER_ELEMENT * 10],
      instanceGlyphData[recordByteIndex + Int16Array.BYTES_PER_ELEMENT * 10 + 1],
      instanceGlyphData[recordByteIndex + Int16Array.BYTES_PER_ELEMENT * 10 + 2],
      instanceGlyphData[recordByteIndex + Int16Array.BYTES_PER_ELEMENT * 10 + 3]
    );
  }
  return colors;
}
