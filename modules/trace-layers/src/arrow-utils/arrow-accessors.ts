import type {Field, Table, Vector} from 'apache-arrow';

/**
 * Builds a generic fast Arrow row accessor that writes values into caller-provided scratch
 * objects or arrays.
 *
 * The caller owns the row shape `T` and must ensure the Arrow table contains columns whose names
 * match the requested keys and whose runtime values are compatible with the TypeScript field
 * types in `T`.
 */
export function buildFastRowAccessorWithScratchGeneric<T extends Record<string, any>>(
  table: Table,
  columns?: Array<keyof T & string>
) {
  const fieldNames: string[] =
    columns?.map(key => key as string) ??
    table.schema.fields.map((field: Field) => (field as Field).name);

  const rawBatches: any[] = (table as any).batches ?? (table as any).chunks ?? null;
  const batches =
    rawBatches && rawBatches.length > 0
      ? rawBatches
      : [
          {
            numRows: table.numRows,
            getChild: (arg: unknown) => {
              try {
                return table.getChild
                  ? table.getChild(arg as never)
                  : (table as any).getColumn?.(arg);
              } catch {
                return null;
              }
            }
          }
        ];

  const batchRowCounts: number[] = batches.map(batch => batch.numRows | 0);
  const batchOffsets: number[] = new Array(batchRowCounts.length);
  for (let batchIndex = 0, offset = 0; batchIndex < batchRowCounts.length; batchIndex += 1) {
    batchOffsets[batchIndex] = offset;
    offset += batchRowCounts[batchIndex] ?? 0;
  }
  const totalRows = batchRowCounts.reduce((total, count) => total + count, 0);

  const perBatchVectors: Array<Array<Vector | null>> = new Array(batches.length);
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const vectors: Array<Vector | null> = new Array(fieldNames.length);
    for (let columnIndex = 0; columnIndex < fieldNames.length; columnIndex += 1) {
      const name = fieldNames[columnIndex]!;
      let vector: Vector | null = null;
      if (typeof batch.getChild === 'function') {
        try {
          vector = batch.getChild(name) ?? batch.getChild(columnIndex) ?? null;
        } catch {
          vector = null;
        }
      }
      if (!vector) {
        try {
          const column = table.getChild ? table.getChild(name) : (table as any).getColumn?.(name);
          if (column) {
            const chunks = (column as any).chunks ?? (column as any).data?.chunks ?? null;
            if (chunks && chunks[batchIndex]) {
              vector = chunks[batchIndex] as Vector;
            } else if ((column as Vector).get) {
              vector = column as Vector;
            }
          }
        } catch {
          vector = null;
        }
      }
      vectors[columnIndex] = vector;
    }
    perBatchVectors[batchIndex] = vectors;
  }

  let lastBatchIndex = 0;
  let scratchValues: Array<T[keyof T]> | undefined;
  let scratchRow: Partial<T> | undefined;

  /**
   * Resolves the owning batch and local row index for a global row index.
   */
  function findBatchIndex(
    globalRowIndex: number
  ): {bi: number; localIndex: number} | {bi: -1; localIndex: -1} {
    if (globalRowIndex < 0 || globalRowIndex >= totalRows) {
      return {bi: -1, localIndex: -1};
    }

    const lastStart = batchOffsets[lastBatchIndex] ?? 0;
    const lastEnd = lastStart + (batchRowCounts[lastBatchIndex] ?? 0);
    if (globalRowIndex >= lastStart && globalRowIndex < lastEnd) {
      return {bi: lastBatchIndex, localIndex: globalRowIndex - lastStart};
    }

    let low = 0;
    let high = batchOffsets.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = batchOffsets[mid] ?? 0;
      const nextStart =
        mid + 1 < batchOffsets.length ? (batchOffsets[mid + 1] ?? totalRows) : totalRows;
      if (globalRowIndex >= start && globalRowIndex < nextStart) {
        lastBatchIndex = mid;
        return {bi: mid, localIndex: globalRowIndex - start};
      }
      if (globalRowIndex < start) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    for (let batchIndex = 0; batchIndex < batchOffsets.length; batchIndex += 1) {
      const start = batchOffsets[batchIndex] ?? 0;
      const end = start + (batchRowCounts[batchIndex] ?? 0);
      if (globalRowIndex >= start && globalRowIndex < end) {
        lastBatchIndex = batchIndex;
        return {bi: batchIndex, localIndex: globalRowIndex - start};
      }
    }

    return {bi: -1, localIndex: -1};
  }

  /**
   * Fills a caller-provided positional scratch array with the values for one row.
   */
  function getValuesInto(
    globalRowIndex: number,
    outArray: Array<T[keyof T]>
  ): Array<T[keyof T]> | null {
    const location = findBatchIndex(globalRowIndex);
    if (location.bi === -1) {
      return null;
    }

    const vectors = perBatchVectors[location.bi] ?? [];
    for (let columnIndex = 0; columnIndex < vectors.length; columnIndex += 1) {
      const vector = vectors[columnIndex];
      outArray[columnIndex] = (
        vector ? ((vector.get(location.localIndex) as any) ?? undefined) : undefined
      ) as T[keyof T];
    }
    return outArray;
  }

  /**
   * Fills a caller-provided scratch object with the values for one row.
   */
  function getRowInto(globalRowIndex: number, outObj: Partial<T>): Partial<T> | null {
    const location = findBatchIndex(globalRowIndex);
    if (location.bi === -1) {
      return null;
    }

    const vectors = perBatchVectors[location.bi] ?? [];
    for (let columnIndex = 0; columnIndex < vectors.length; columnIndex += 1) {
      const name = fieldNames[columnIndex] as keyof T;
      const vector = vectors[columnIndex];
      (outObj as Record<keyof T, T[keyof T]>)[name] = (
        vector ? ((vector.get(location.localIndex) as any) ?? undefined) : undefined
      ) as T[typeof name];
    }
    return outObj;
  }

  /**
   * Reuses a lazily created scratch array owned by this accessor.
   */
  function getValuesIntoScratch(globalRowIndex: number) {
    if (!scratchValues) {
      scratchValues = new Array(fieldNames.length) as Array<T[keyof T]>;
    }
    return getValuesInto(globalRowIndex, scratchValues);
  }

  /**
   * Reuses a lazily created scratch object owned by this accessor.
   */
  function getRowIntoScratch(globalRowIndex: number) {
    if (!scratchRow) {
      scratchRow = Object.create(null) as Partial<T>;
    }
    return getRowInto(globalRowIndex, scratchRow);
  }

  return {
    columns: fieldNames as Array<keyof T & string>,
    totalRows,
    getValuesInto,
    getRowInto,
    getValuesIntoScratch,
    getRowIntoScratch
  } as const;
}
