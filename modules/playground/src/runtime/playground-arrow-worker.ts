// deck.gl-community
// SPDX-License-Identifier: MIT

import {ArrowLoader} from '@loaders.gl/arrow';
import {parseInBatches} from '@loaders.gl/core';
import {
  DataType,
  RecordBatchReader,
  TimeUnit,
  type Field,
  type Table,
  type Vector
} from 'apache-arrow';
import {MAX_DATA_BYTES, MAX_DATA_ROWS, validatePlaygroundRows} from './playground-webmcp-data';

// Decode through loaders.gl inside this worker, never through its remote worker fallback.
self.onmessage = async (event: MessageEvent<Uint8Array>) => {
  try {
    const bytes = event.data;
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_DATA_BYTES) {
      throw new Error('Invalid Arrow input');
    }
    validateSchema(bytes);
    // The batch API returns Arrow tables without serializing unsupported dictionary schemas.
    const batches: ReturnType<typeof ArrowLoader.parseInBatches> = await parseInBatches(
      [bytes],
      ArrowLoader,
      {
        worker: false,
        arrow: {shape: 'arrow-table'}
      }
    );
    const rows: Record<string, unknown>[] = [];
    const appendRows = createRowNormalizer(rows);
    for await (const batch of batches) {
      if (batch.batchType !== 'data' || batch.shape !== 'arrow-table') {
        throw new Error('Invalid Arrow result');
      }
      appendRows(batch.data);
    }
    self.postMessage({ok: true, rows: validatePlaygroundRows(rows)});
  } catch {
    // Parser messages can contain input values; only a fixed status crosses the worker boundary.
    self.postMessage({ok: false});
  }
};

function validateSchema(bytes: Uint8Array): void {
  // tableFromIPC accepts some incomplete streams as empty tables; require an actual IPC schema.
  const reader = RecordBatchReader.from(bytes);
  try {
    reader.open();
    if (!reader.schema) throw new Error('Missing Arrow schema');
  } finally {
    reader.cancel();
  }
}

function createRowNormalizer(rows: Record<string, unknown>[]): (table: Table) => void {
  let nodes = 1;
  let bytes = 2;
  const encoder = new TextEncoder();
  const account = (value: string) => {
    bytes += encoder.encode(value).byteLength;
    if (bytes > MAX_DATA_BYTES) throw new Error('Data is too large');
  };
  const visit = (depth: number) => {
    if (++nodes > 100_000 || depth > 16) throw new Error('Data is too complex');
  };
  const validateFields = (fields: Field[], depth: number) => {
    if (fields.length > 128 || depth > 16) throw new Error('Too many fields');
    const names = new Set<string>();
    for (const field of fields) {
      if (
        field.name.length > 128 ||
        ['__proto__', 'prototype', 'constructor'].includes(field.name) ||
        names.has(field.name)
      ) {
        throw new Error('Invalid Arrow field');
      }
      names.add(field.name);
      validateType(field.type, depth);
    }
  };
  const isScalar = (type: DataType) =>
    DataType.isNull(type) ||
    DataType.isBool(type) ||
    DataType.isUtf8(type) ||
    DataType.isLargeUtf8(type) ||
    DataType.isInt(type) ||
    DataType.isFloat(type) ||
    DataType.isDate(type) ||
    (DataType.isTimestamp(type) &&
      (type.unit === TimeUnit.SECOND || type.unit === TimeUnit.MILLISECOND));
  const validateType = (type: DataType, depth: number) => {
    visit(depth);
    if (DataType.isDictionary(type)) {
      if (!isScalar(type.dictionary)) throw new Error('Unsupported dictionary type');
    } else if (DataType.isStruct(type)) {
      validateFields(type.children, depth + 1);
    } else if (DataType.isList(type) || DataType.isFixedSizeList(type)) {
      if (type.children.length !== 1) throw new Error('Invalid list type');
      validateType(type.children[0].type, depth + 1);
    } else if (!isScalar(type)) {
      // Binary, decimals, maps, unions and sub-millisecond timestamps need explicit encodings.
      throw new Error('Unsupported Arrow type');
    }
  };

  const readFields = (fields: Field[], vectors: Vector[], index: number, depth: number) => {
    visit(depth);
    account('{}');
    return Object.fromEntries(
      fields.map((field, column) => {
        account(`${column ? ',' : ''}${JSON.stringify(field.name)}:`);
        return [field.name, readValue(vectors[column], index, depth + 1)];
      })
    );
  };
  const readValue = (vector: Vector, index: number, depth: number): unknown => {
    visit(depth);
    if (!vector || !vector.isValid(index)) {
      account('null');
      return null;
    }
    const type = vector.type;
    if (DataType.isStruct(type)) {
      return readFields(
        type.children,
        type.children.map((_, column) => vector.getChildAt(column)!),
        index,
        depth
      );
    }
    if (DataType.isList(type) || DataType.isFixedSizeList(type)) {
      const values = vector.get(index) as Vector;
      if (!Number.isSafeInteger(values.length) || values.length > MAX_DATA_ROWS) {
        throw new Error('Too many list values');
      }
      account('[]');
      return Array.from({length: values.length}, (_, item) => {
        if (item) account(',');
        return readValue(values, item, depth + 1);
      });
    }
    const scalarType = DataType.isDictionary(type) ? type.dictionary : type;
    let value = vector.get(index);
    // Preserve 64-bit integers exactly; Arrow dates and supported timestamps are UTC epoch ms.
    if (typeof value === 'bigint') value = value.toString();
    if (
      value !== null &&
      (DataType.isDate(scalarType) || DataType.isTimestamp(scalarType)) &&
      !Number.isSafeInteger(value)
    ) {
      throw new Error('Date is outside the supported range');
    }
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      !(typeof value === 'number' && Number.isFinite(value))
    ) {
      throw new Error('Invalid Arrow value');
    }
    account(JSON.stringify(value));
    return value;
  };

  return table => {
    if (
      !Number.isSafeInteger(table.numRows) ||
      table.numRows < 0 ||
      rows.length + table.numRows > MAX_DATA_ROWS
    ) {
      throw new Error('Too many rows');
    }
    validateFields(table.schema.fields, 2);
    const columns = table.schema.fields.map((_, index) => table.getChildAt(index)!);
    for (let index = 0; index < table.numRows; index++) {
      if (rows.length) account(',');
      rows.push(readFields(table.schema.fields, columns, index, 1));
    }
  };
}
