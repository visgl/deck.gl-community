// Minimal WebGL attribute text layout ported from WIP luma.gl text utilities.
// SPDX-License-Identifier: MIT

import {createIterable} from '@deck.gl/core';

import {getArrowUtf8ColumnSource, getUtf8ColumnSourceRowView} from '../../utils/utf8-string-view';

import type {Utf8ColumnSource, Utf8StringView} from '../../utils/utf8-string-view';
import type {FastTextCharacter, FastTextCharacterMapping} from './font-atlas';
import type {Accessor, AccessorContext, Color, LayerDataSource, Position} from '@deck.gl/core';
import type * as arrow from 'apache-arrow';

/** Horizontal label anchor accepted by {@link FastTextLayer}. */
export type FastTextAnchor = 'start' | 'middle' | 'end';

/** Vertical label baseline accepted by {@link FastTextLayer}. */
export type FastTextAlignmentBaseline = 'top' | 'center' | 'bottom';

/** Content alignment mode accepted by {@link FastTextLayer}. */
export type FastTextContentAlign = 'none' | 'start' | 'center' | 'end';

/** Source-row clip rectangle in deck.gl text content coordinates. */
export type FastTextClipRect = readonly [x: number, y: number, width: number, height: number];

/** Direct-buffer UTF-8 column source consumed by {@link FastTextLayer}. */
export type FastTextUtf8ColumnSource = Utf8ColumnSource;

/** Arrow Utf8 vector or pre-normalized UTF-8 column source consumed by {@link FastTextLayer}. */
export type FastTextUtf8Column = arrow.Vector<arrow.Utf8> | FastTextUtf8ColumnSource;

/** Accessor that fills a caller-owned UTF-8 byte view for one source row. */
export type FastTextUtf8ViewAccessor<DataT> = (
  object: DataT,
  out: Utf8StringView,
  objectInfo: AccessorContext<DataT>
) => boolean;

/**
 * Bytes per generated glyph vertex record.
 *
 * The record stores `sint16x2 glyphOffsets`, `uint16x4 glyphFrames`, `sint16x4 clipRect`,
 * and `unorm8x4 color`.
 */
export const FAST_TEXT_GLYPH_VERTEX_BYTE_STRIDE =
  Int16Array.BYTES_PER_ELEMENT * 10 + Uint8Array.BYTES_PER_ELEMENT * 4;

/** Packed per-glyph typed arrays consumed by the fast text shader. */
export type FastTextGlyphAttributes = {
  /**
   * Interleaved generated glyph records.
   *
   * Each record stores `[offsetX, offsetY]` as signed 16-bit integers,
   * `[atlasX, atlasY, atlasWidth, atlasHeight]` as unsigned 16-bit integers,
   * `[clipX, clipY, clipWidth, clipHeight]` as signed 16-bit integers, and RGBA color as
   * four normalized unsigned bytes.
   */
  instanceGlyphData: Uint8Array;
  /** Per-glyph 2D source anchor position, repeated from source label rows. */
  instancePositions: Float32Array;
};

/** Timing counters captured while expanding source rows into FastText glyph attributes. */
export type FastTextGlyphBuildStats = {
  /** Source text path used for this glyph build. */
  sourceMode: 'string' | 'utf8-column' | 'utf8-view';
  /** Layout path used for this glyph build. */
  layoutMode: 'single-line' | 'multi-line';
  /** Number of source rows visited. */
  rowCount: number;
  /** Number of generated glyph instances. */
  glyphCount: number;
  /** Number of bytes occupied by generated CPU attribute arrays. */
  attributeByteLength: number;
  /** Time spent normalizing the optional Arrow UTF-8 column source. */
  columnNormalizeDurationMs: number;
  /** Time spent counting rows and glyphs before fixed-size allocation. */
  countDurationMs: number;
  /** Time spent allocating generated CPU attribute arrays. */
  allocateDurationMs: number;
  /** Time spent writing generated CPU attribute arrays. */
  writeDurationMs: number;
  /** Write-phase time spent resolving label text or UTF-8 row views. */
  textResolveDurationMs: number;
  /** Write-phase time spent resolving style accessors for position, color, and clip rect. */
  styleAccessorDurationMs: number;
  /** Write-phase time spent computing label layout offsets and widths. */
  layoutDurationMs: number;
  /** Write-phase time spent packing per-glyph attribute records. */
  glyphWriteDurationMs: number;
  /** Total time spent in FastText glyph-data construction. */
  totalDurationMs: number;
};

/** Result of expanding source text rows into one glyph instance stream. */
export type FastTextGlyphData = {
  /** Number of rendered glyph instances. */
  length: number;
  /** Cumulative glyph starts, one entry per source row plus a terminal entry. */
  startIndices: Uint32Array;
  /** Packed per-glyph attributes ready for GPU upload. */
  attributes: FastTextGlyphAttributes;
  /** Characters observed while visiting source text rows. */
  characterSet: Set<string>;
  /** Approximate CPU typed-array bytes occupied by this glyph data. */
  byteLength: number;
  /** Timing counters for the CPU glyph attribute build. */
  buildStats: FastTextGlyphBuildStats;
};

/** Inputs used to collect an automatic atlas character set. */
export type CollectFastTextCharacterSetProps<DataT> = {
  /** Source label rows. */
  data: LayerDataSource<DataT>;
  /** Source-row text accessor. */
  getText: Accessor<DataT, string>;
};

/** Inputs used to build a packed fast text glyph stream. */
export type BuildFastTextGlyphDataProps<DataT> = {
  /** Source label rows. */
  data: LayerDataSource<DataT>;
  /** Source-row text accessor used by the string path. */
  getText: Accessor<DataT, string>;
  /** Optional UTF-8 text column used by the byte path. */
  textUtf8Column?: FastTextUtf8Column | null;
  /** Source-row UTF-8 column row accessor. Defaults to the source row index. */
  getTextUtf8Row?: Accessor<DataT, number | null>;
  /** Optional accessor that fills a reused UTF-8 byte view for the source row. */
  getTextUtf8?: FastTextUtf8ViewAccessor<DataT> | null;
  /** Whether source labels are expected to be single-line strings. */
  singleLine: boolean;
  /** Source-row position accessor. */
  getPosition: Accessor<DataT, Position>;
  /** Source-row color accessor. */
  getColor: Accessor<DataT, Color>;
  /** Layer-wide horizontal text anchor. */
  textAnchor: FastTextAnchor;
  /** Layer-wide vertical alignment baseline. */
  alignmentBaseline: FastTextAlignmentBaseline;
  /** Source-row content clip rectangle accessor. */
  getClipRect: Accessor<DataT, FastTextClipRect>;
  /** Glyph metric lookup keyed by rendered character. */
  mapping: FastTextCharacterMapping;
  /** Atlas baseline offset in pixels. */
  baselineOffset: number;
  /** Atlas font size in pixels. */
  fontSize: number;
  /** Unitless line-height multiplier. */
  lineHeight: number;
};

/** Inputs used to rewrite dynamic per-row glyph attributes without rebuilding text layout. */
export type UpdateFastTextDynamicGlyphAttributesProps<DataT> = {
  /** Source label rows. */
  data: LayerDataSource<DataT>;
  /** Existing glyph data whose dynamic attributes should be updated in place. */
  glyphData: FastTextGlyphData;
  /** Source-row position accessor. */
  getPosition: Accessor<DataT, Position>;
  /** Source-row color accessor. */
  getColor: Accessor<DataT, Color>;
  /** Source-row content clip rectangle accessor. */
  getClipRect: Accessor<DataT, FastTextClipRect>;
  /** Whether to rewrite repeated per-glyph anchor positions. */
  updatePositions: boolean;
  /** Whether to rewrite packed per-glyph colors. */
  updateColors: boolean;
  /** Whether to rewrite packed per-glyph clip rectangles. */
  updateClipRects: boolean;
};

/** Timing counters captured while rewriting dynamic FastText glyph attributes. */
export type FastTextDynamicGlyphUpdateStats = {
  /** Number of source rows visited. */
  rowCount: number;
  /** Number of generated glyph instances visited. */
  glyphCount: number;
  /** Number of bytes occupied by the existing CPU attribute arrays. */
  attributeByteLength: number;
  /** Time spent resolving position accessors. */
  positionAccessorDurationMs: number;
  /** Time spent resolving color accessors. */
  colorAccessorDurationMs: number;
  /** Time spent resolving clip-rectangle accessors. */
  clipRectAccessorDurationMs: number;
  /** Time spent writing dynamic glyph attributes. */
  writeDurationMs: number;
  /** Total time spent updating dynamic glyph attributes. */
  totalDurationMs: number;
};

/** Build a direct-buffer UTF-8 column source without copying Arrow string bytes. */
export function buildFastTextUtf8ColumnSource(
  utf8Column: arrow.Vector<arrow.Utf8>
): FastTextUtf8ColumnSource | null {
  return getArrowUtf8ColumnSource(utf8Column);
}

/** Collect all renderable characters reached by a text accessor. */
export function collectFastTextCharacterSet<DataT>(
  props: CollectFastTextCharacterSetProps<DataT>
): Set<string> {
  const characterSet = new Set<string>();
  const {iterable, objectInfo} = createIterable(props.data);

  for (const object of iterable) {
    objectInfo.index++;
    const text = resolveAccessor(props.getText, object, objectInfo) ?? '';
    for (const character of Array.from(text)) {
      if (character !== '\n') {
        characterSet.add(character);
      }
    }
  }

  return characterSet;
}

/** Build packed per-glyph attributes for one fast text layer update. */
export function buildFastTextGlyphData<DataT>(
  props: BuildFastTextGlyphDataProps<DataT>
): FastTextGlyphData {
  const buildStartTime = performance.now();
  const columnNormalizeStartTime = performance.now();
  const textUtf8Column = resolveFastTextUtf8ColumnSource(props.textUtf8Column);
  const columnNormalizeDurationMs = performance.now() - columnNormalizeStartTime;
  if (props.textUtf8Column && !textUtf8Column) {
    throw new Error('FastTextLayer textUtf8Column must expose Arrow Utf8 buffers');
  }
  if ((textUtf8Column || props.getTextUtf8) && !props.singleLine) {
    throw new Error('FastTextLayer UTF-8 text sources require singleLine text layout');
  }

  const glyphData = props.singleLine
    ? buildSingleLineGlyphData({
        ...props,
        textUtf8Column
      })
    : buildMultiLineGlyphData(props);
  return withFastTextGlyphBuildStats(glyphData, {
    columnNormalizeDurationMs,
    totalDurationMs: performance.now() - buildStartTime
  });
}

/** Build packed per-glyph attributes for source rows that are expected to contain no newlines. */
export function buildSingleLineGlyphData<DataT>(
  props: BuildFastTextGlyphDataProps<DataT> & {
    /** Normalized UTF-8 column source, when the byte path is active. */
    textUtf8Column?: FastTextUtf8ColumnSource | null;
  }
): FastTextGlyphData {
  const buildStartTime = performance.now();
  const countStartTime = performance.now();
  const countResult = countSingleLineFastTextGlyphs(props);
  const countDurationMs = performance.now() - countStartTime;
  const allocateStartTime = performance.now();
  const attributes = allocateFastTextGlyphAttributes(countResult.glyphCount);
  const startIndices = new Uint32Array(countResult.rowCount + 1);
  const allocateDurationMs = performance.now() - allocateStartTime;
  const writeState: FastTextGlyphWriteState = {
    glyphIndex: 0,
    startIndices,
    attributes,
    glyphRecordViews: createFastTextGlyphRecordViews(attributes.instanceGlyphData)
  };
  const writeTimings = createFastTextGlyphWriteTimings();
  const byteLookup =
    props.textUtf8Column || props.getTextUtf8 ? buildFastTextByteGlyphLookup(props.mapping) : null;
  const scratchUtf8View: Utf8StringView = {data: EMPTY_BYTES, start: 0, end: 0};
  const {iterable, objectInfo} = createIterable(props.data);

  const writeStartTime = performance.now();
  for (const object of iterable) {
    objectInfo.index++;
    startIndices[objectInfo.index] = writeState.glyphIndex;
    if (props.textUtf8Column && byteLookup) {
      writeSingleLineUtf8LabelGlyphs(
        props,
        props.textUtf8Column,
        byteLookup,
        scratchUtf8View,
        object,
        objectInfo,
        writeState,
        writeTimings
      );
    } else if (props.getTextUtf8 && byteLookup) {
      writeSingleLineUtf8ViewLabelGlyphs(
        props,
        props.getTextUtf8,
        byteLookup,
        scratchUtf8View,
        object,
        objectInfo,
        writeState,
        writeTimings
      );
    } else {
      writeSingleLineStringLabelGlyphs(props, object, objectInfo, writeState, writeTimings);
    }
  }
  startIndices[countResult.rowCount] = writeState.glyphIndex;
  const writeDurationMs = performance.now() - writeStartTime;

  return createFastTextGlyphData(countResult, startIndices, attributes, {
    sourceMode: props.textUtf8Column ? 'utf8-column' : props.getTextUtf8 ? 'utf8-view' : 'string',
    layoutMode: 'single-line',
    columnNormalizeDurationMs: 0,
    countDurationMs,
    allocateDurationMs,
    writeDurationMs,
    ...writeTimings,
    totalDurationMs: performance.now() - buildStartTime
  });
}

/** Build packed per-glyph attributes for source rows that may contain newlines. */
export function buildMultiLineGlyphData<DataT>(
  props: BuildFastTextGlyphDataProps<DataT>
): FastTextGlyphData {
  const buildStartTime = performance.now();
  const countStartTime = performance.now();
  const countResult = countMultiLineFastTextGlyphs(props);
  const countDurationMs = performance.now() - countStartTime;
  const allocateStartTime = performance.now();
  const attributes = allocateFastTextGlyphAttributes(countResult.glyphCount);
  const startIndices = new Uint32Array(countResult.rowCount + 1);
  const allocateDurationMs = performance.now() - allocateStartTime;
  const writeState: FastTextGlyphWriteState = {
    glyphIndex: 0,
    startIndices,
    attributes,
    glyphRecordViews: createFastTextGlyphRecordViews(attributes.instanceGlyphData)
  };
  const writeTimings = createFastTextGlyphWriteTimings();
  const {iterable, objectInfo} = createIterable(props.data);

  const writeStartTime = performance.now();
  for (const object of iterable) {
    objectInfo.index++;
    startIndices[objectInfo.index] = writeState.glyphIndex;
    writeMultiLineLabelGlyphs(props, object, objectInfo, writeState, writeTimings);
  }
  startIndices[countResult.rowCount] = writeState.glyphIndex;
  const writeDurationMs = performance.now() - writeStartTime;

  return createFastTextGlyphData(countResult, startIndices, attributes, {
    sourceMode: 'string',
    layoutMode: 'multi-line',
    columnNormalizeDurationMs: 0,
    countDurationMs,
    allocateDurationMs,
    writeDurationMs,
    ...writeTimings,
    totalDurationMs: performance.now() - buildStartTime
  });
}

/** Rewrite dynamic per-row glyph attributes while preserving generated text layout attributes. */
export function updateFastTextDynamicGlyphAttributes<DataT>(
  props: UpdateFastTextDynamicGlyphAttributesProps<DataT>
): FastTextDynamicGlyphUpdateStats {
  const updateStartTime = performance.now();
  const glyphRecordViews = createFastTextGlyphRecordViews(
    props.glyphData.attributes.instanceGlyphData
  );
  const {iterable, objectInfo} = createIterable(props.data);
  let rowCount = 0;
  let glyphCount = 0;
  let positionAccessorDurationMs = 0;
  let colorAccessorDurationMs = 0;
  let clipRectAccessorDurationMs = 0;
  let writeDurationMs = 0;

  for (const object of iterable) {
    objectInfo.index++;
    rowCount++;
    const rowGlyphStart = props.glyphData.startIndices[objectInfo.index] ?? 0;
    const rowGlyphEnd = props.glyphData.startIndices[objectInfo.index + 1] ?? rowGlyphStart;
    if (rowGlyphEnd <= rowGlyphStart) {
      continue;
    }

    let position: Position = DEFAULT_POSITION;
    let color: Color = DEFAULT_COLOR;
    let clipRect: FastTextClipRect = DEFAULT_CLIP_RECT;
    if (props.updatePositions) {
      const accessorStartTime = performance.now();
      position = resolveAccessor(props.getPosition, object, objectInfo) ?? DEFAULT_POSITION;
      positionAccessorDurationMs += performance.now() - accessorStartTime;
    }
    if (props.updateColors) {
      const accessorStartTime = performance.now();
      color = resolveAccessor(props.getColor, object, objectInfo) ?? DEFAULT_COLOR;
      colorAccessorDurationMs += performance.now() - accessorStartTime;
    }
    if (props.updateClipRects) {
      const accessorStartTime = performance.now();
      clipRect = resolveAccessor(props.getClipRect, object, objectInfo) ?? DEFAULT_CLIP_RECT;
      clipRectAccessorDurationMs += performance.now() - accessorStartTime;
    }

    const writeStartTime = performance.now();
    for (let glyphIndex = rowGlyphStart; glyphIndex < rowGlyphEnd; glyphIndex += 1) {
      if (props.updatePositions) {
        writeFastTextGlyphPosition(props.glyphData.attributes, glyphIndex, position);
      }
      if (props.updateClipRects) {
        writeFastTextGlyphClipRect(glyphRecordViews, glyphIndex, clipRect);
      }
      if (props.updateColors) {
        writeFastTextGlyphColor(glyphRecordViews, glyphIndex, color);
      }
    }
    writeDurationMs += performance.now() - writeStartTime;
    glyphCount += rowGlyphEnd - rowGlyphStart;
  }

  return {
    rowCount,
    glyphCount,
    attributeByteLength: props.glyphData.byteLength,
    positionAccessorDurationMs,
    colorAccessorDurationMs,
    clipRectAccessorDurationMs,
    writeDurationMs,
    totalDurationMs: performance.now() - updateStartTime
  };
}

type FastTextGlyphCount = {
  /** Number of rendered glyph instances. */
  readonly glyphCount: number;
  /** Number of source text rows. */
  readonly rowCount: number;
  /** Characters observed while counting rows. */
  readonly characterSet: Set<string>;
};

type FastTextGlyphWriteState = {
  /** Current glyph write cursor. */
  glyphIndex: number;
  /** Cumulative glyph starts by source row. */
  readonly startIndices: Uint32Array;
  /** Typed arrays receiving per-glyph attributes. */
  readonly attributes: FastTextGlyphAttributes;
  /** Typed views over the interleaved generated glyph record buffer. */
  readonly glyphRecordViews: FastTextGlyphRecordViews;
};

type FastTextGlyphRecordViews = {
  /** Signed 16-bit view used for glyph offsets. */
  readonly int16Values: Int16Array;
  /** Unsigned 16-bit view used for atlas frames. */
  readonly uint16Values: Uint16Array;
  /** Unsigned 8-bit view used for packed colors. */
  readonly uint8Values: Uint8Array;
};

type FastTextGlyphWriteTimings = {
  /** Write-phase time spent resolving label text or UTF-8 row views. */
  textResolveDurationMs: number;
  /** Write-phase time spent resolving style accessors for position, color, and clip rect. */
  styleAccessorDurationMs: number;
  /** Write-phase time spent computing label layout offsets and widths. */
  layoutDurationMs: number;
  /** Write-phase time spent packing per-glyph attribute records. */
  glyphWriteDurationMs: number;
};

type FastTextByteGlyphLookup = readonly (FastTextCharacter | undefined)[];

type FastTextLineLayout = {
  /** Characters in this source text line. */
  readonly characters: readonly string[];
  /** Line width in atlas pixels, including missing-character advances. */
  readonly width: number;
  /** Renderable glyphs in this line. */
  readonly glyphCount: number;
};

const MISSING_CHARACTER_ADVANCE = 32;
const FAST_TEXT_BYTE_LOOKUP_SIZE = 256;
const EMPTY_BYTES = new Uint8Array();
const DEFAULT_COLOR: readonly [number, number, number, number] = [0, 0, 0, 255];
const DEFAULT_POSITION: readonly [number, number, number] = [0, 0, 0];
const DEFAULT_CLIP_RECT: FastTextClipRect = [0, 0, -1, -1];
const ANCHOR_OFFSET_MULTIPLIER: Record<FastTextAnchor, number> = {
  start: 0,
  middle: -0.5,
  end: -1
};
const BASELINE_OFFSET_MULTIPLIER: Record<FastTextAlignmentBaseline, number> = {
  top: 0,
  center: -0.5,
  bottom: -1
};

/** Count single-line rendered glyphs and rows before allocating fixed-size typed arrays. */
function countSingleLineFastTextGlyphs<DataT>(
  props: Pick<
    BuildFastTextGlyphDataProps<DataT>,
    'data' | 'getText' | 'getTextUtf8' | 'getTextUtf8Row' | 'mapping'
  > & {
    /** Normalized UTF-8 column source, when the byte path is active. */
    readonly textUtf8Column?: FastTextUtf8ColumnSource | null;
  }
): FastTextGlyphCount {
  if (props.textUtf8Column) {
    return countSingleLineUtf8FastTextGlyphs(props, props.textUtf8Column);
  }
  if (props.getTextUtf8) {
    return countSingleLineUtf8ViewFastTextGlyphs(props, props.getTextUtf8);
  }
  return countSingleLineStringFastTextGlyphs(props);
}

/** Count single-line UTF-8 bytes as glyph records without decoding strings. */
function countSingleLineUtf8FastTextGlyphs<DataT>(
  props: Pick<BuildFastTextGlyphDataProps<DataT>, 'data' | 'getTextUtf8Row'>,
  textUtf8Column: FastTextUtf8ColumnSource
): FastTextGlyphCount {
  let glyphCount = 0;
  let rowCount = 0;
  const characterSet = new Set<string>();
  const textView: Utf8StringView = {data: EMPTY_BYTES, start: 0, end: 0};
  const {iterable, objectInfo} = createIterable(props.data);

  for (const object of iterable) {
    objectInfo.index++;
    rowCount++;
    const rowIndex = resolveTextUtf8Row(props.getTextUtf8Row, object, objectInfo);
    if (rowIndex == null || !getUtf8ColumnSourceRowView(textUtf8Column, rowIndex, textView)) {
      continue;
    }
    glyphCount += textView.end - textView.start;
  }

  return {glyphCount, rowCount, characterSet};
}

/** Count single-line UTF-8 byte-view labels without decoding strings. */
function countSingleLineUtf8ViewFastTextGlyphs<DataT>(
  props: Pick<BuildFastTextGlyphDataProps<DataT>, 'data'>,
  getTextUtf8: FastTextUtf8ViewAccessor<DataT>
): FastTextGlyphCount {
  let glyphCount = 0;
  let rowCount = 0;
  const characterSet = new Set<string>();
  const textView: Utf8StringView = {data: EMPTY_BYTES, start: 0, end: 0};
  const {iterable, objectInfo} = createIterable(props.data);

  for (const object of iterable) {
    objectInfo.index++;
    rowCount++;
    if (getTextUtf8(object, textView, objectInfo)) {
      glyphCount += Math.max(0, textView.end - textView.start);
    }
  }

  return {glyphCount, rowCount, characterSet};
}

/** Count single-line JavaScript string code units without scanning for newline separators. */
function countSingleLineStringFastTextGlyphs<DataT>(
  props: Pick<BuildFastTextGlyphDataProps<DataT>, 'data' | 'getText'>
): FastTextGlyphCount {
  let glyphCount = 0;
  let rowCount = 0;
  const characterSet = new Set<string>();
  const {iterable, objectInfo} = createIterable(props.data);

  for (const object of iterable) {
    objectInfo.index++;
    rowCount++;
    const text = resolveAccessor(props.getText, object, objectInfo) ?? '';
    glyphCount += text.length;
    for (let index = 0; index < text.length; index += 1) {
      characterSet.add(text[index]!);
    }
  }

  return {glyphCount, rowCount, characterSet};
}

/** Count multiline rendered glyphs and rows before allocating fixed-size typed arrays. */
function countMultiLineFastTextGlyphs<DataT>(
  props: Pick<BuildFastTextGlyphDataProps<DataT>, 'data' | 'getText' | 'mapping'>
): FastTextGlyphCount {
  let glyphCount = 0;
  let rowCount = 0;
  const characterSet = new Set<string>();
  const {iterable, objectInfo} = createIterable(props.data);

  for (const object of iterable) {
    objectInfo.index++;
    rowCount++;
    const text = resolveAccessor(props.getText, object, objectInfo) ?? '';
    for (const character of Array.from(text)) {
      if (character === '\n') {
        continue;
      }
      characterSet.add(character);
      glyphCount++;
    }
  }

  return {glyphCount, rowCount, characterSet};
}

/** Allocate all per-glyph typed arrays for one glyph count. */
function allocateFastTextGlyphAttributes(glyphCount: number): FastTextGlyphAttributes {
  return {
    instanceGlyphData: new Uint8Array(glyphCount * FAST_TEXT_GLYPH_VERTEX_BYTE_STRIDE),
    instancePositions: new Float32Array(glyphCount * 2)
  };
}

/** Build typed record views over the packed generated glyph data. */
function createFastTextGlyphRecordViews(instanceGlyphData: Uint8Array): FastTextGlyphRecordViews {
  return {
    int16Values: new Int16Array(instanceGlyphData.buffer),
    uint16Values: new Uint16Array(instanceGlyphData.buffer),
    uint8Values: instanceGlyphData
  };
}

/** Create the public glyph data wrapper around generated typed arrays. */
function createFastTextGlyphData(
  countResult: FastTextGlyphCount,
  startIndices: Uint32Array,
  attributes: FastTextGlyphAttributes,
  stats: Omit<FastTextGlyphBuildStats, 'rowCount' | 'glyphCount' | 'attributeByteLength'>
): FastTextGlyphData {
  const byteLength =
    startIndices.byteLength +
    attributes.instanceGlyphData.byteLength +
    attributes.instancePositions.byteLength;
  return {
    length: countResult.glyphCount,
    startIndices,
    attributes,
    characterSet: countResult.characterSet,
    byteLength,
    buildStats: {
      ...stats,
      rowCount: countResult.rowCount,
      glyphCount: countResult.glyphCount,
      attributeByteLength: byteLength
    }
  };
}

function createFastTextGlyphWriteTimings(): FastTextGlyphWriteTimings {
  return {
    textResolveDurationMs: 0,
    styleAccessorDurationMs: 0,
    layoutDurationMs: 0,
    glyphWriteDurationMs: 0
  };
}

/** Return one glyph-data object with caller-supplied timing overrides. */
function withFastTextGlyphBuildStats(
  glyphData: FastTextGlyphData,
  stats: Pick<FastTextGlyphBuildStats, 'columnNormalizeDurationMs' | 'totalDurationMs'>
): FastTextGlyphData {
  return {
    ...glyphData,
    buildStats: {
      ...glyphData.buildStats,
      ...stats
    }
  };
}

/** Write all generated glyph records for one single-line JavaScript string label row. */
function writeSingleLineStringLabelGlyphs<DataT>(
  props: BuildFastTextGlyphDataProps<DataT>,
  object: DataT,
  objectInfo: AccessorContext<DataT>,
  writeState: FastTextGlyphWriteState,
  timings: FastTextGlyphWriteTimings
): void {
  const textResolveStartTime = performance.now();
  const text = resolveAccessor(props.getText, object, objectInfo) ?? '';
  timings.textResolveDurationMs += performance.now() - textResolveStartTime;
  if (!text) {
    return;
  }

  const styleAccessorStartTime = performance.now();
  const position = resolveAccessor(props.getPosition, object, objectInfo) ?? DEFAULT_POSITION;
  const color = resolveAccessor(props.getColor, object, objectInfo) ?? DEFAULT_COLOR;
  const clipRect = resolveAccessor(props.getClipRect, object, objectInfo) ?? DEFAULT_CLIP_RECT;
  timings.styleAccessorDurationMs += performance.now() - styleAccessorStartTime;

  const layoutStartTime = performance.now();
  const width = getSingleLineStringWidth(text, props.mapping);
  const lineOffsetX = ANCHOR_OFFSET_MULTIPLIER[props.textAnchor] * width;
  const rowBaselineY = getSingleLineBaselineY(props);
  timings.layoutDurationMs += performance.now() - layoutStartTime;

  let cursorX = 0;

  const glyphWriteStartTime = performance.now();
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    const frame = props.mapping[character];
    writeFastTextGlyphRecord({
      frame,
      lineOffsetX,
      cursorX,
      rowBaselineY,
      position,
      color,
      clipRect,
      writeState
    });
    cursorX += frame?.advance ?? MISSING_CHARACTER_ADVANCE;
  }
  timings.glyphWriteDurationMs += performance.now() - glyphWriteStartTime;
}

/** Write all generated glyph records for one single-line UTF-8 byte label row. */
function writeSingleLineUtf8LabelGlyphs<DataT>(
  props: BuildFastTextGlyphDataProps<DataT>,
  textUtf8Column: FastTextUtf8ColumnSource,
  byteLookup: FastTextByteGlyphLookup,
  textView: Utf8StringView,
  object: DataT,
  objectInfo: AccessorContext<DataT>,
  writeState: FastTextGlyphWriteState,
  timings: FastTextGlyphWriteTimings
): void {
  const textResolveStartTime = performance.now();
  const rowIndex = resolveTextUtf8Row(props.getTextUtf8Row, object, objectInfo);
  const hasTextView =
    rowIndex != null && getUtf8ColumnSourceRowView(textUtf8Column, rowIndex, textView);
  timings.textResolveDurationMs += performance.now() - textResolveStartTime;
  if (!hasTextView) {
    return;
  }
  if (textView.end <= textView.start) {
    return;
  }

  const styleAccessorStartTime = performance.now();
  const position = resolveAccessor(props.getPosition, object, objectInfo) ?? DEFAULT_POSITION;
  const color = resolveAccessor(props.getColor, object, objectInfo) ?? DEFAULT_COLOR;
  const clipRect = resolveAccessor(props.getClipRect, object, objectInfo) ?? DEFAULT_CLIP_RECT;
  timings.styleAccessorDurationMs += performance.now() - styleAccessorStartTime;

  const layoutStartTime = performance.now();
  const width = getSingleLineUtf8Width(textView, byteLookup);
  const lineOffsetX = ANCHOR_OFFSET_MULTIPLIER[props.textAnchor] * width;
  const rowBaselineY = getSingleLineBaselineY(props);
  timings.layoutDurationMs += performance.now() - layoutStartTime;

  let cursorX = 0;

  const glyphWriteStartTime = performance.now();
  for (let byteIndex = textView.start; byteIndex < textView.end; byteIndex += 1) {
    const frame = byteLookup[textView.data[byteIndex] ?? -1];
    writeFastTextGlyphRecord({
      frame,
      lineOffsetX,
      cursorX,
      rowBaselineY,
      position,
      color,
      clipRect,
      writeState
    });
    cursorX += frame?.advance ?? MISSING_CHARACTER_ADVANCE;
  }
  timings.glyphWriteDurationMs += performance.now() - glyphWriteStartTime;
}

/** Write all generated glyph records for one accessor-provided UTF-8 byte label row. */
function writeSingleLineUtf8ViewLabelGlyphs<DataT>(
  props: BuildFastTextGlyphDataProps<DataT>,
  getTextUtf8: FastTextUtf8ViewAccessor<DataT>,
  byteLookup: FastTextByteGlyphLookup,
  textView: Utf8StringView,
  object: DataT,
  objectInfo: AccessorContext<DataT>,
  writeState: FastTextGlyphWriteState,
  timings: FastTextGlyphWriteTimings
): void {
  const textResolveStartTime = performance.now();
  const hasTextView = getTextUtf8(object, textView, objectInfo);
  timings.textResolveDurationMs += performance.now() - textResolveStartTime;
  if (!hasTextView || textView.end <= textView.start) {
    return;
  }

  const styleAccessorStartTime = performance.now();
  const position = resolveAccessor(props.getPosition, object, objectInfo) ?? DEFAULT_POSITION;
  const color = resolveAccessor(props.getColor, object, objectInfo) ?? DEFAULT_COLOR;
  const clipRect = resolveAccessor(props.getClipRect, object, objectInfo) ?? DEFAULT_CLIP_RECT;
  timings.styleAccessorDurationMs += performance.now() - styleAccessorStartTime;

  const layoutStartTime = performance.now();
  const width = getSingleLineUtf8Width(textView, byteLookup);
  const lineOffsetX = ANCHOR_OFFSET_MULTIPLIER[props.textAnchor] * width;
  const rowBaselineY = getSingleLineBaselineY(props);
  timings.layoutDurationMs += performance.now() - layoutStartTime;

  let cursorX = 0;

  const glyphWriteStartTime = performance.now();
  for (let byteIndex = textView.start; byteIndex < textView.end; byteIndex += 1) {
    const frame = byteLookup[textView.data[byteIndex] ?? -1];
    writeFastTextGlyphRecord({
      frame,
      lineOffsetX,
      cursorX,
      rowBaselineY,
      position,
      color,
      clipRect,
      writeState
    });
    cursorX += frame?.advance ?? MISSING_CHARACTER_ADVANCE;
  }
  timings.glyphWriteDurationMs += performance.now() - glyphWriteStartTime;
}

/** Write all generated glyph records for one multiline source label row. */
function writeMultiLineLabelGlyphs<DataT>(
  props: BuildFastTextGlyphDataProps<DataT>,
  object: DataT,
  objectInfo: AccessorContext<DataT>,
  writeState: FastTextGlyphWriteState,
  timings: FastTextGlyphWriteTimings
): void {
  const textResolveStartTime = performance.now();
  const text = resolveAccessor(props.getText, object, objectInfo) ?? '';
  timings.textResolveDurationMs += performance.now() - textResolveStartTime;
  if (!text) {
    return;
  }

  const styleAccessorStartTime = performance.now();
  const position = resolveAccessor(props.getPosition, object, objectInfo) ?? DEFAULT_POSITION;
  const color = resolveAccessor(props.getColor, object, objectInfo) ?? DEFAULT_COLOR;
  const clipRect = resolveAccessor(props.getClipRect, object, objectInfo) ?? DEFAULT_CLIP_RECT;
  timings.styleAccessorDurationMs += performance.now() - styleAccessorStartTime;

  const layoutStartTime = performance.now();
  const lines = buildFastTextLineLayouts(text, props.mapping);
  const lineHeightPixels = props.lineHeight * props.fontSize;
  const labelHeight = lines.length * lineHeightPixels;
  const blockOffsetY = BASELINE_OFFSET_MULTIPLIER[props.alignmentBaseline] * labelHeight;
  timings.layoutDurationMs += performance.now() - layoutStartTime;

  const glyphWriteStartTime = performance.now();
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineOffsetX = ANCHOR_OFFSET_MULTIPLIER[props.textAnchor] * line.width;
    const rowBaselineY =
      blockOffsetY + props.baselineOffset + lineHeightPixels / 2 + lineIndex * lineHeightPixels;
    let cursorX = 0;

    for (const character of line.characters) {
      const frame = props.mapping[character];
      writeFastTextGlyphRecord({
        frame,
        lineOffsetX,
        cursorX,
        rowBaselineY,
        position,
        color,
        clipRect,
        writeState
      });
      cursorX += frame?.advance ?? MISSING_CHARACTER_ADVANCE;
    }
  }
  timings.glyphWriteDurationMs += performance.now() - glyphWriteStartTime;
}

/** Convert one source text into line widths and per-line characters. */
function buildFastTextLineLayouts(
  text: string,
  mapping: FastTextCharacterMapping
): FastTextLineLayout[] {
  const lines: FastTextLineLayout[] = [];
  let currentCharacters: string[] = [];
  let currentWidth = 0;
  let currentGlyphCount = 0;

  for (const character of Array.from(text)) {
    if (character === '\n') {
      lines.push({
        characters: currentCharacters,
        width: currentWidth,
        glyphCount: currentGlyphCount
      });
      currentCharacters = [];
      currentWidth = 0;
      currentGlyphCount = 0;
      continue;
    }

    const frame = mapping[character];
    currentCharacters.push(character);
    currentWidth += frame?.advance ?? MISSING_CHARACTER_ADVANCE;
    if (frame) {
      currentGlyphCount++;
    }
  }

  lines.push({
    characters: currentCharacters,
    width: currentWidth,
    glyphCount: currentGlyphCount
  });
  return lines;
}

/** Resolve a caller-supplied Arrow vector or pre-normalized source into a direct UTF-8 source. */
function resolveFastTextUtf8ColumnSource(
  textUtf8Column: FastTextUtf8Column | null | undefined
): FastTextUtf8ColumnSource | null {
  if (!textUtf8Column) {
    return null;
  }
  return isFastTextUtf8ColumnSource(textUtf8Column)
    ? textUtf8Column
    : buildFastTextUtf8ColumnSource(textUtf8Column);
}

/** Return whether an object already has the normalized UTF-8 column-source shape. */
function isFastTextUtf8ColumnSource(
  textUtf8Column: FastTextUtf8Column
): textUtf8Column is FastTextUtf8ColumnSource {
  return 'rowCount' in textUtf8Column && 'chunks' in textUtf8Column;
}

/** Build an ASCII byte-to-glyph lookup from the string-keyed atlas mapping. */
function buildFastTextByteGlyphLookup(mapping: FastTextCharacterMapping): FastTextByteGlyphLookup {
  const lookup = new Array<FastTextCharacter | undefined>(FAST_TEXT_BYTE_LOOKUP_SIZE);
  for (let byte = 0; byte < 128; byte += 1) {
    lookup[byte] = mapping[String.fromCharCode(byte)];
  }
  return lookup;
}

/** Resolve the source-row index inside a UTF-8 column. */
function resolveTextUtf8Row<DataT>(
  getTextUtf8Row: Accessor<DataT, number | null> | undefined,
  object: DataT,
  objectInfo: AccessorContext<DataT>
): number | null {
  return getTextUtf8Row === undefined
    ? objectInfo.index
    : resolveAccessor(getTextUtf8Row, object, objectInfo);
}

/** Compute one single-line string label width without looking for newline separators. */
function getSingleLineStringWidth(text: string, mapping: FastTextCharacterMapping): number {
  let width = 0;
  for (let index = 0; index < text.length; index += 1) {
    width += mapping[text[index]!]?.advance ?? MISSING_CHARACTER_ADVANCE;
  }
  return width;
}

/** Compute one single-line UTF-8 byte label width without decoding bytes to characters. */
function getSingleLineUtf8Width(
  textView: Utf8StringView,
  byteLookup: FastTextByteGlyphLookup
): number {
  let width = 0;
  for (let byteIndex = textView.start; byteIndex < textView.end; byteIndex += 1) {
    width += byteLookup[textView.data[byteIndex] ?? -1]?.advance ?? MISSING_CHARACTER_ADVANCE;
  }
  return width;
}

/** Compute the baseline Y position for a one-line label. */
function getSingleLineBaselineY<DataT>(props: BuildFastTextGlyphDataProps<DataT>): number {
  const lineHeightPixels = props.lineHeight * props.fontSize;
  const blockOffsetY = BASELINE_OFFSET_MULTIPLIER[props.alignmentBaseline] * lineHeightPixels;
  return blockOffsetY + props.baselineOffset + lineHeightPixels / 2;
}

/** Write one packed glyph record into the generated attribute arrays. */
function writeFastTextGlyphRecord(params: {
  /** Glyph atlas frame and metrics, or undefined for missing glyphs. */
  readonly frame: FastTextCharacter | undefined;
  /** Line-level horizontal offset in atlas pixels. */
  readonly lineOffsetX: number;
  /** Cursor X position before the glyph advance is applied. */
  readonly cursorX: number;
  /** Baseline Y position for this glyph row. */
  readonly rowBaselineY: number;
  /** Source label anchor position. */
  readonly position: Position;
  /** Source label color. */
  readonly color: Color;
  /** Source label content clip rectangle. */
  readonly clipRect: FastTextClipRect;
  /** Mutable glyph write cursor and typed-array views. */
  readonly writeState: FastTextGlyphWriteState;
}): void {
  const frame = params.frame;
  const glyphIndex = params.writeState.glyphIndex;
  const recordInt16Index =
    (glyphIndex * FAST_TEXT_GLYPH_VERTEX_BYTE_STRIDE) / Int16Array.BYTES_PER_ELEMENT;
  const glyphX =
    params.lineOffsetX + params.cursorX + (frame?.anchorX ?? 0) - (frame?.width ?? 0) / 2;
  const glyphY = params.rowBaselineY - (frame?.anchorY ?? 0);
  const writeState = params.writeState;

  writeFastTextGlyphPosition(writeState.attributes, glyphIndex, params.position);
  writeState.glyphRecordViews.int16Values[recordInt16Index] = toInt16(glyphX);
  writeState.glyphRecordViews.int16Values[recordInt16Index + 1] = toInt16(glyphY);
  writeState.glyphRecordViews.uint16Values[recordInt16Index + 2] = toUint16(frame?.x ?? 0);
  writeState.glyphRecordViews.uint16Values[recordInt16Index + 3] = toUint16(frame?.y ?? 0);
  writeState.glyphRecordViews.uint16Values[recordInt16Index + 4] = toUint16(frame?.width ?? 0);
  writeState.glyphRecordViews.uint16Values[recordInt16Index + 5] = toUint16(frame?.height ?? 0);
  writeFastTextGlyphClipRect(writeState.glyphRecordViews, glyphIndex, params.clipRect);
  writeFastTextGlyphColor(writeState.glyphRecordViews, glyphIndex, params.color);
  writeState.glyphIndex++;
}

/** Write one source anchor position into the repeated per-glyph position array. */
function writeFastTextGlyphPosition(
  attributes: FastTextGlyphAttributes,
  glyphIndex: number,
  position: Position
): void {
  const positionOffset = glyphIndex * 2;
  attributes.instancePositions[positionOffset] = position[0] ?? 0;
  attributes.instancePositions[positionOffset + 1] = position[1] ?? 0;
}

/** Write one source clip rectangle into the packed generated glyph record. */
function writeFastTextGlyphClipRect(
  glyphRecordViews: FastTextGlyphRecordViews,
  glyphIndex: number,
  clipRect: FastTextClipRect
): void {
  const recordInt16Index =
    (glyphIndex * FAST_TEXT_GLYPH_VERTEX_BYTE_STRIDE) / Int16Array.BYTES_PER_ELEMENT;
  glyphRecordViews.int16Values[recordInt16Index + 6] = toInt16(clipRect[0] ?? 0);
  glyphRecordViews.int16Values[recordInt16Index + 7] = toInt16(clipRect[1] ?? 0);
  glyphRecordViews.int16Values[recordInt16Index + 8] = toInt16ClipDimension(clipRect[2] ?? -1);
  glyphRecordViews.int16Values[recordInt16Index + 9] = toInt16ClipDimension(clipRect[3] ?? -1);
}

/** Write one source color into the packed generated glyph record. */
function writeFastTextGlyphColor(
  glyphRecordViews: FastTextGlyphRecordViews,
  glyphIndex: number,
  color: Color
): void {
  const recordByteIndex = glyphIndex * FAST_TEXT_GLYPH_VERTEX_BYTE_STRIDE;
  writeColor(
    glyphRecordViews.uint8Values,
    recordByteIndex + Int16Array.BYTES_PER_ELEMENT * 10,
    color
  );
}

/** Resolve deck accessors that may be constants or functions. */
function resolveAccessor<DataT, ValueT>(
  accessor: Accessor<DataT, ValueT>,
  object: DataT,
  objectInfo: AccessorContext<DataT>
): ValueT {
  return typeof accessor === 'function'
    ? (accessor as (object: DataT, objectInfo: AccessorContext<DataT>) => ValueT)(
        object,
        objectInfo
      )
    : accessor;
}

/** Write one deck color into a byte array with a default opaque alpha. */
function writeColor(target: Uint8Array, offset: number, color: Color): void {
  target[offset] = clampByte(color[0] ?? DEFAULT_COLOR[0]);
  target[offset + 1] = clampByte(color[1] ?? DEFAULT_COLOR[1]);
  target[offset + 2] = clampByte(color[2] ?? DEFAULT_COLOR[2]);
  target[offset + 3] = clampByte(color[3] ?? DEFAULT_COLOR[3]);
}

/** Clamp one color channel into the unsigned byte range. */
function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Round and validate one value for the signed 16-bit generated attribute record. */
function toInt16(value: number): number {
  const integerValue = Math.round(value);
  if (integerValue < -32768 || integerValue > 32767) {
    throw new Error(`FastTextLayer value ${value} is outside the signed 16-bit range`);
  }
  return integerValue;
}

/** Round one clip dimension while preserving positive non-zero values. */
function toInt16ClipDimension(value: number): number {
  const integerValue = value > 0 ? Math.max(1, Math.round(value)) : Math.round(value);
  if (integerValue < -32768 || integerValue > 32767) {
    throw new Error(`FastTextLayer value ${value} is outside the signed 16-bit range`);
  }
  return integerValue;
}

/** Round and validate one atlas frame value for the unsigned 16-bit generated attribute record. */
function toUint16(value: number): number {
  const integerValue = Math.round(value);
  if (integerValue < 0 || integerValue > 65535) {
    throw new Error(
      `FastTextLayer glyph frame value ${value} is outside the unsigned 16-bit range`
    );
  }
  return integerValue;
}
