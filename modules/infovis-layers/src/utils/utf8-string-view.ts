import type * as arrow from 'apache-arrow';

/** Byte-range view for one UTF-8 encoded string. */
export type Utf8StringView = {
  /** Backing UTF-8 bytes. */
  data: Uint8Array;
  /** Inclusive byte offset where the string starts. */
  start: number;
  /** Exclusive byte offset where the string ends. */
  end: number;
};

/** Normalized direct-buffer source for one Arrow Utf8 vector. */
export type Utf8ColumnSource = {
  /** Number of logical rows in the column. */
  readonly rowCount: number;
  /** Direct-buffer chunks that make up the column. */
  readonly chunks: readonly Utf8ColumnSourceChunk[];
  /** Returns whether one logical row is valid. */
  readonly isValid: (rowIndex: number) => boolean;
};

/** One direct-buffer chunk in a normalized Arrow Utf8 column source. */
export type Utf8ColumnSourceChunk = {
  /** Logical row index where this chunk starts. */
  readonly rowOffset: number;
  /** Number of logical rows in this chunk. */
  readonly rowCount: number;
  /** Row offset inside the chunk's value-offset buffer. */
  readonly valueOffsetIndex: number;
  /** UTF-8 value-offset buffer. */
  readonly valueOffsets: Int32Array | Uint32Array;
  /** Contiguous UTF-8 value bytes. */
  readonly values: Uint8Array;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Encodes one JavaScript string into a reusable UTF-8 byte view.
 */
export function makeUtf8StringView(value: string): Utf8StringView {
  const data = textEncoder.encode(value);
  return {data, start: 0, end: data.length};
}

/**
 * Builds a direct-buffer source from an Arrow Utf8 vector without copying UTF-8 bytes.
 */
export function getArrowUtf8ColumnSource(
  utf8Column: arrow.Vector<arrow.Utf8>
): Utf8ColumnSource | null {
  const chunks = getArrowUtf8DataChunks(utf8Column);
  if (!chunks || chunks.length === 0) {
    return null;
  }

  const sourceChunks: Utf8ColumnSourceChunk[] = [];
  let rowOffset = 0;
  for (const chunk of chunks) {
    const valueOffsets = chunk.valueOffsets;
    const values = chunk.values;
    if (!valueOffsets || !values) {
      return null;
    }
    sourceChunks.push({
      rowOffset,
      rowCount: chunk.length,
      valueOffsetIndex: 0,
      valueOffsets,
      values
    });
    rowOffset += chunk.length;
  }

  return {
    rowCount: utf8Column.length,
    chunks: sourceChunks,
    isValid: rowIndex => utf8Column.isValid(rowIndex)
  };
}

/**
 * Fills a reusable UTF-8 view for one Arrow Utf8 row without decoding the row to a string.
 */
export function getArrowUtf8RowView(
  utf8Column: arrow.Vector<arrow.Utf8>,
  rowIndex: number,
  out: Utf8StringView
): boolean {
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= utf8Column.length) {
    return false;
  }
  if (!utf8Column.isValid(rowIndex)) {
    return false;
  }

  const chunks = getArrowUtf8DataChunks(utf8Column);
  if (!chunks || chunks.length === 0) {
    return false;
  }

  let rowOffset = 0;
  for (const chunk of chunks) {
    const chunkEnd = rowOffset + chunk.length;
    if (rowIndex >= rowOffset && rowIndex < chunkEnd) {
      const valueOffsets = chunk.valueOffsets;
      const values = chunk.values;
      if (!valueOffsets || !values) {
        return false;
      }
      return fillUtf8StringView(valueOffsets, values, rowIndex - rowOffset, out);
    }
    rowOffset = chunkEnd;
  }

  return false;
}

/**
 * Fills a reusable UTF-8 view for one normalized Utf8 column row.
 */
export function getUtf8ColumnSourceRowView(
  source: Utf8ColumnSource,
  rowIndex: number,
  out: Utf8StringView
): boolean {
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= source.rowCount) {
    return false;
  }
  if (!source.isValid(rowIndex)) {
    return false;
  }

  for (const chunk of source.chunks) {
    const chunkEnd = chunk.rowOffset + chunk.rowCount;
    if (rowIndex < chunk.rowOffset || rowIndex >= chunkEnd) {
      continue;
    }

    return fillUtf8StringView(
      chunk.valueOffsets,
      chunk.values,
      chunk.valueOffsetIndex + rowIndex - chunk.rowOffset,
      out
    );
  }

  return false;
}

/**
 * Finds the first row in an Arrow Utf8 column whose bytes equal the requested string view.
 */
export function arrowFindUtf8(
  utf8Column: arrow.Vector<arrow.Utf8>,
  value: Utf8StringView,
  startRow = 0
): number {
  const normalizedStartRow = Math.max(0, startRow);
  const fastResult = arrowFindUtf8InDataChunks(utf8Column, value, normalizedStartRow);
  if (fastResult !== null) {
    return fastResult;
  }

  const expected = decodeUtf8StringView(value);
  for (let rowIndex = normalizedStartRow; rowIndex < utf8Column.length; rowIndex += 1) {
    if (utf8Column.get(rowIndex) === expected) {
      return rowIndex;
    }
  }
  return -1;
}

type ArrowUtf8DataChunk = {
  /** Number of rows in this Arrow data chunk. */
  readonly length: number;
  /** Row offset inside the chunk's value-offset buffer. */
  readonly offset?: number;
  /** UTF-8 value-offset buffer. */
  readonly valueOffsets?: Int32Array | Uint32Array;
  /** Contiguous UTF-8 value bytes. */
  readonly values?: Uint8Array;
};

/**
 * Scans Arrow's contiguous Utf8 buffers directly when the vector exposes them.
 */
function arrowFindUtf8InDataChunks(
  utf8Column: arrow.Vector<arrow.Utf8>,
  value: Utf8StringView,
  startRow: number
): number | null {
  const chunks = getArrowUtf8DataChunks(utf8Column);
  if (!chunks || chunks.length === 0) {
    return null;
  }

  let globalRowOffset = 0;
  for (const chunk of chunks) {
    const valueOffsets = chunk.valueOffsets;
    const values = chunk.values;
    if (!valueOffsets || !values) {
      return null;
    }

    const chunkStartRow = Math.max(0, startRow - globalRowOffset);
    for (let chunkRow = chunkStartRow; chunkRow < chunk.length; chunkRow += 1) {
      const globalRow = globalRowOffset + chunkRow;
      if (!utf8Column.isValid(globalRow)) {
        continue;
      }

      const start = valueOffsets[chunkRow];
      const end = valueOffsets[chunkRow + 1];
      if (start !== undefined && end !== undefined && utf8BytesEqual(values, start, end, value)) {
        return globalRow;
      }
    }
    globalRowOffset += chunk.length;
  }
  return -1;
}

function getArrowUtf8DataChunks(
  utf8Column: arrow.Vector<arrow.Utf8>
): readonly ArrowUtf8DataChunk[] | undefined {
  return (utf8Column as unknown as {data?: readonly ArrowUtf8DataChunk[]}).data;
}

function fillUtf8StringView(
  valueOffsets: Int32Array | Uint32Array,
  values: Uint8Array,
  offsetIndex: number,
  out: Utf8StringView
): boolean {
  const start = valueOffsets[offsetIndex];
  const end = valueOffsets[offsetIndex + 1];
  if (start === undefined || end === undefined) {
    return false;
  }

  out.data = values;
  out.start = start;
  out.end = end;
  return true;
}

/**
 * Returns whether a UTF-8 byte range equals one target UTF-8 view.
 */
function utf8BytesEqual(
  data: Uint8Array,
  start: number,
  end: number,
  value: Utf8StringView
): boolean {
  const valueLength = value.end - value.start;
  if (end - start !== valueLength) {
    return false;
  }
  for (let index = 0; index < valueLength; index += 1) {
    if (data[start + index] !== value.data[value.start + index]) {
      return false;
    }
  }
  return true;
}

function decodeUtf8StringView(value: Utf8StringView): string {
  return textDecoder.decode(value.data.subarray(value.start, value.end));
}
