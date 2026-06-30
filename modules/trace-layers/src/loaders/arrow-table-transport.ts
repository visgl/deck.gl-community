// loaders.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import * as arrow from 'apache-arrow';

import type {Buffers} from 'apache-arrow/data';

/** Serializable Arrow dictionary index type. */
export type SerializableArrowKeyType = 'int8' | 'int16' | 'int32' | 'uint8' | 'uint16' | 'uint32';

/** Serializable Arrow data type used by dehydrated Arrow tables. */
export type SerializableArrowDataType =
  | 'null'
  | 'bool'
  | 'int8'
  | 'int16'
  | 'int32'
  | 'int64'
  | 'uint8'
  | 'uint16'
  | 'uint32'
  | 'uint64'
  | 'float16'
  | 'float32'
  | 'float64'
  | 'binary'
  | 'utf8'
  | 'date-day'
  | 'date-millisecond'
  | 'time-second'
  | 'time-millisecond'
  | 'time-microsecond'
  | 'time-nanosecond'
  | 'timestamp-second'
  | 'timestamp-millisecond'
  | 'timestamp-microsecond'
  | 'timestamp-nanosecond'
  | 'interval-daytime'
  | 'interval-yearmonth'
  | {
      /** Composite type discriminator. */
      type: 'decimal';
      /** Decimal bit width. */
      bitWidth: number;
      /** Decimal precision. */
      precision: number;
      /** Decimal scale. */
      scale: number;
    }
  | {
      /** Composite type discriminator. */
      type: 'list';
      /** Single list value field. */
      children: SerializableArrowField[];
    }
  | {
      /** Composite type discriminator. */
      type: 'struct';
      /** Struct child fields. */
      children: SerializableArrowField[];
    }
  | {
      /** Composite type discriminator. */
      type: 'fixed-size-binary';
      /** Fixed byte width. */
      byteWidth: number;
    }
  | {
      /** Composite type discriminator. */
      type: 'fixed-size-list';
      /** Number of values in each fixed-size list. */
      listSize: number;
      /** Single list value field. */
      children: SerializableArrowField[];
    }
  | {
      /** Composite type discriminator. */
      type: 'map';
      /** Whether map keys are sorted. */
      keysSorted: boolean;
      /** Map child fields. */
      children: SerializableArrowField[];
    }
  | {
      /** Composite type discriminator. */
      type: 'dictionary';
      /** Dictionary id. */
      id: number;
      /** Dictionary index type. */
      indices: SerializableArrowKeyType;
      /** Dictionary value type. */
      dictionary: SerializableArrowDataType;
      /** Whether dictionary values are ordered. */
      isOrdered: boolean;
    };

/** Serializable Arrow field used by dehydrated Arrow table schemas. */
export type SerializableArrowField = {
  /** Field name. */
  name: string;
  /** Field data type. */
  type: SerializableArrowDataType;
  /** Whether this field accepts null values. */
  nullable?: boolean;
  /** Field metadata. */
  metadata?: Record<string, string>;
};

/** Serializable Arrow schema used by dehydrated Arrow tables. */
export type SerializableArrowSchema = {
  /** Schema fields. */
  fields: SerializableArrowField[];
  /** Schema metadata. */
  metadata: Record<string, string>;
};

/** Structured-cloneable Arrow Data payload used by `dehydrateArrowTable`. */
export type DehydratedArrowData<T extends arrow.DataType = arrow.DataType> = {
  /** Serialized Arrow data type. */
  type: SerializableArrowDataType;
  /** Row offset within this data chunk. */
  offset: number;
  /** Row length for this data chunk. */
  length: number;
  /** Arrow null count, preserving the lazy null-count state. */
  nullCount: number;
  /** Arrow internal buffers for this data chunk. */
  buffers: Partial<Buffers<T>>;
  /** Child data chunks. */
  children: DehydratedArrowData[];
  /** Optional dictionary vector payload. */
  dictionary?: DehydratedArrowVector;
};

/** Structured-cloneable Arrow Vector payload used by `dehydrateArrowTable`. */
export type DehydratedArrowVector<T extends arrow.DataType = arrow.DataType> = {
  /** Vector data chunks. */
  data: DehydratedArrowData<T>[];
};

/** Structured-cloneable Arrow RecordBatch payload used by `dehydrateArrowTable`. */
export type DehydratedArrowRecordBatch<T extends arrow.TypeMap = arrow.TypeMap> = {
  /** Record batch struct data. */
  data: DehydratedArrowData<arrow.Struct<T>>;
};

/** Structured-cloneable Arrow Table payload for same-version Arrow JS boundaries. */
export type DehydratedArrowTable<T extends arrow.TypeMap = arrow.TypeMap> = {
  /** Payload shape discriminator. */
  shape: 'arrow-table';
  /** Arrow transport mode. */
  transport: 'arrow-js';
  /** Serialized Arrow schema. */
  schema: SerializableArrowSchema;
  /** Dehydrated record batches. */
  batches: DehydratedArrowRecordBatch<T>[];
};

/** Arrow IPC payload for robust Arrow table transport across Arrow JS versions. */
export type SerializedArrowTableIPC = {
  /** Payload shape discriminator. */
  shape: 'arrow-table';
  /** Arrow transport mode. */
  transport: 'arrow-ipc';
  /** Arrow IPC bytes. */
  data: Uint8Array;
};

/** Options for rebuilding Arrow buffers before worker transport. */
export type SplitArrowBuffersOptions = {
  /**
   * Buffer copy mode.
   * - `none`: do not copy any typed arrays.
   * - `sliced`: copy only typed arrays that view a larger ArrayBuffer.
   * - `all`: copy every Arrow internal typed array.
   */
  copy?: 'none' | 'sliced' | 'all';
};

/**
 * Dehydrates an Arrow table into a structured-cloneable payload.
 */
export function dehydrateArrowTable<T extends arrow.TypeMap>(
  table: arrow.Table<T>,
  options?: SplitArrowBuffersOptions
): DehydratedArrowTable<T> {
  const splitTable = splitArrowTableBuffers(table, options);
  return {
    shape: 'arrow-table',
    transport: 'arrow-js',
    schema: serializeArrowSchema(splitTable.schema),
    batches: splitTable.batches.map(dehydrateArrowRecordBatch)
  };
}

/**
 * Hydrates a table payload created by `dehydrateArrowTable` into a real Arrow table.
 */
export function hydrateArrowTable<T extends arrow.TypeMap>(
  table: DehydratedArrowTable<T>
): arrow.Table<T> {
  const schema = deserializeArrowSchema(table.schema) as arrow.Schema<T>;
  const recordBatches = table.batches.map(
    recordBatch => new arrow.RecordBatch(schema, hydrateArrowData(recordBatch.data))
  );
  return new arrow.Table(schema, recordBatches);
}

/**
 * Serializes an Arrow table to Arrow IPC bytes.
 */
export function serializeArrowTableToIPC(table: arrow.Table): SerializedArrowTableIPC {
  return {
    shape: 'arrow-table',
    transport: 'arrow-ipc',
    data: arrow.tableToIPC(table)
  };
}

/**
 * Deserializes Arrow IPC bytes from `serializeArrowTableToIPC` into a real Arrow table.
 */
export function deserializeArrowTableFromIPC(
  table: SerializedArrowTableIPC | ArrayBuffer | Uint8Array
): arrow.Table {
  const data = isSerializedArrowTableIPC(table) ? table.data : table;
  return arrow.tableFromIPC(data);
}

/**
 * Collects ArrayBuffers that should be transferred with one dehydrated Arrow table payload.
 */
export function collectDehydratedArrowTableTransferables(
  table: DehydratedArrowTable
): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  table.batches.forEach(recordBatch =>
    collectDehydratedArrowDataBuffers(recordBatch.data, buffers)
  );
  return [...buffers];
}

/** Arrow integer data types supported as dictionary index types. */
type ArrowDictionaryKeyType =
  | arrow.Int8
  | arrow.Int16
  | arrow.Int32
  | arrow.Uint8
  | arrow.Uint16
  | arrow.Uint32;

/** Typed-array variants used by Arrow JS internal buffers. */
type ArrowTypedArray =
  | Uint8Array
  | Uint8ClampedArray
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

/** Arrow runtime objects whose internal buffers can be copied before transport. */
type SplitArrowBuffersInput =
  | arrow.Table
  | arrow.RecordBatch
  | arrow.Vector
  | arrow.Data<arrow.DataType>;

/** Dehydrates one Arrow record batch into the structured-cloneable transport shape. */
function dehydrateArrowRecordBatch<T extends arrow.TypeMap>(
  recordBatch: arrow.RecordBatch<T>
): DehydratedArrowRecordBatch<T> {
  return {data: dehydrateArrowData(recordBatch.data)};
}

/** Dehydrates one Arrow Data node, including child data and dictionary vectors. */
function dehydrateArrowData<T extends arrow.DataType>(data: arrow.Data<T>): DehydratedArrowData<T> {
  const buffers = getArrowDataBuffers(data);
  return {
    type: serializeArrowType(data.type),
    offset: data.offset,
    length: data.length,
    // @ts-expect-error _nullCount is protected. Preserve the Arrow lazy null-count state.
    nullCount: data._nullCount,
    buffers: {
      [arrow.BufferType.OFFSET]: buffers[arrow.BufferType.OFFSET],
      [arrow.BufferType.DATA]: buffers[arrow.BufferType.DATA],
      [arrow.BufferType.VALIDITY]: buffers[arrow.BufferType.VALIDITY],
      [arrow.BufferType.TYPE]: buffers[arrow.BufferType.TYPE]
    },
    children: (data.children ?? []).map(childData => dehydrateArrowData(childData)),
    dictionary: data.dictionary ? dehydrateArrowVector(data.dictionary) : undefined
  };
}

/** Dehydrates one Arrow vector into its data chunks. */
function dehydrateArrowVector<T extends arrow.DataType>(
  vector: arrow.Vector<T>
): DehydratedArrowVector<T> {
  return {data: vector.data.map(data => dehydrateArrowData(data))};
}

/** Hydrates one transported Arrow Data node back into Arrow JS runtime objects. */
function hydrateArrowData<T extends arrow.DataType>(data: DehydratedArrowData<T>): arrow.Data<T> {
  const children = data.children.map(childData => hydrateArrowData(childData));
  const dictionary = data.dictionary ? hydrateArrowVector(data.dictionary) : undefined;
  return new arrow.Data(
    deserializeArrowType(data.type) as T,
    data.offset,
    data.length,
    data.nullCount,
    data.buffers,
    children,
    dictionary
  );
}

/** Hydrates one transported Arrow vector back into an Arrow JS vector. */
function hydrateArrowVector<T extends arrow.DataType>(
  vector: DehydratedArrowVector<T>
): arrow.Vector<T> {
  return new arrow.Vector(vector.data.map(data => hydrateArrowData(data)));
}

/** Copies Arrow table buffers according to the requested transport copy policy. */
function splitArrowTableBuffers<T extends arrow.TypeMap>(
  table: arrow.Table<T>,
  options?: SplitArrowBuffersOptions
): arrow.Table<T> {
  return splitArrowBuffers(table, options);
}

/** Copies Arrow buffers for table-like inputs according to the requested transport copy policy. */
function splitArrowBuffers<T extends arrow.TypeMap>(
  input: arrow.Table<T>,
  options?: SplitArrowBuffersOptions
): arrow.Table<T>;
/** Copies Arrow buffers for record-batch inputs according to the requested transport copy policy. */
function splitArrowBuffers<T extends arrow.TypeMap>(
  input: arrow.RecordBatch<T>,
  options?: SplitArrowBuffersOptions
): arrow.RecordBatch<T>;
/** Copies Arrow buffers for vector inputs according to the requested transport copy policy. */
function splitArrowBuffers<T extends arrow.DataType>(
  input: arrow.Vector<T>,
  options?: SplitArrowBuffersOptions
): arrow.Vector<T>;
/** Copies Arrow buffers for data-node inputs according to the requested transport copy policy. */
function splitArrowBuffers<T extends arrow.DataType>(
  input: arrow.Data<T>,
  options?: SplitArrowBuffersOptions
): arrow.Data<T>;
/** Copies Arrow buffers for all supported Arrow runtime input shapes. */
function splitArrowBuffers<T extends SplitArrowBuffersInput>(
  input: T,
  options: SplitArrowBuffersOptions = {}
): T {
  if (isArrowTable(input)) {
    return splitArrowTableBuffersInternal(input, options) as T;
  }
  if (isArrowRecordBatch(input)) {
    return splitArrowRecordBatchBuffers(input, options) as T;
  }
  if (isArrowVector(input)) {
    return splitArrowVectorBuffers(input, options) as T;
  }
  return splitArrowDataBuffers(input, options) as T;
}

/** Returns whether a transport input is an Arrow table. */
function isArrowTable(input: SplitArrowBuffersInput): input is arrow.Table {
  return 'batches' in input;
}

/** Returns whether a transport input is an Arrow record batch. */
function isArrowRecordBatch(input: SplitArrowBuffersInput): input is arrow.RecordBatch {
  return 'schema' in input && 'data' in input && !Array.isArray(input.data);
}

/** Returns whether a transport input is an Arrow vector. */
function isArrowVector(input: SplitArrowBuffersInput): input is arrow.Vector {
  return 'data' in input && Array.isArray(input.data);
}

/** Copies all record batches owned by one Arrow table according to the copy policy. */
function splitArrowTableBuffersInternal<T extends arrow.TypeMap>(
  table: arrow.Table<T>,
  options: SplitArrowBuffersOptions
): arrow.Table<T> {
  const recordBatches = table.batches.map(recordBatch =>
    splitArrowRecordBatchBuffers(recordBatch, options)
  );
  return new arrow.Table(table.schema, recordBatches);
}

/** Copies buffers owned by one Arrow record batch according to the copy policy. */
function splitArrowRecordBatchBuffers<T extends arrow.TypeMap>(
  recordBatch: arrow.RecordBatch<T>,
  options: SplitArrowBuffersOptions
): arrow.RecordBatch<T> {
  return new arrow.RecordBatch(
    recordBatch.schema,
    splitArrowDataBuffers(recordBatch.data, options)
  );
}

/** Copies buffers owned by one Arrow Data node, including child and dictionary buffers. */
function splitArrowDataBuffers<T extends arrow.DataType>(
  data: arrow.Data<T>,
  options: SplitArrowBuffersOptions
): arrow.Data<T> {
  const sourceBuffers = getArrowDataBuffers(data);
  const children = (data.children ?? []).map(childData =>
    splitArrowDataBuffers(childData, options)
  );
  const dictionary = data.dictionary
    ? splitArrowVectorBuffers(data.dictionary, options)
    : undefined;
  const buffers: Partial<Buffers<T>> = {
    [arrow.BufferType.OFFSET]: splitArrowBuffer(sourceBuffers[arrow.BufferType.OFFSET], options),
    [arrow.BufferType.DATA]: splitArrowBuffer(sourceBuffers[arrow.BufferType.DATA], options),
    [arrow.BufferType.VALIDITY]: splitArrowBuffer(
      sourceBuffers[arrow.BufferType.VALIDITY],
      options
    ),
    [arrow.BufferType.TYPE]: splitArrowBuffer(sourceBuffers[arrow.BufferType.TYPE], options)
  };

  return new arrow.Data(
    data.type,
    data.offset,
    data.length,
    // @ts-expect-error _nullCount is protected. Reuse it to preserve lazy null-count state.
    data._nullCount,
    buffers,
    children,
    dictionary
  );
}

/** Copies buffers owned by one Arrow vector according to the copy policy. */
function splitArrowVectorBuffers<T extends arrow.DataType>(
  vector: arrow.Vector<T>,
  options: SplitArrowBuffersOptions
): arrow.Vector<T> {
  return new arrow.Vector(vector.data.map(data => splitArrowDataBuffers(data, options)));
}

/** Reads Arrow Data buffers without requiring the computed `buffers` getter to be populated. */
function getArrowDataBuffers<T extends arrow.DataType>(data: arrow.Data<T>): Partial<Buffers<T>> {
  const dataWithFields = data as unknown as {
    buffers?: Partial<Buffers<T>>;
    nullBitmap?: unknown;
    typeIds?: unknown;
    valueOffsets?: unknown;
    values?: unknown;
  };
  const directBuffers = {
    [arrow.BufferType.OFFSET]: dataWithFields.valueOffsets,
    [arrow.BufferType.DATA]: dataWithFields.values,
    [arrow.BufferType.VALIDITY]: dataWithFields.nullBitmap,
    [arrow.BufferType.TYPE]: dataWithFields.typeIds
  } as Partial<Buffers<T>>;

  if (hasArrowDataBuffer(directBuffers)) {
    return directBuffers;
  }

  return dataWithFields.buffers ?? {};
}

/** Returns whether an Arrow buffer collection contains any materialized buffer value. */
function hasArrowDataBuffer<T extends arrow.DataType>(buffers: Partial<Buffers<T>>): boolean {
  return Object.values(buffers).some(value => value != null);
}

/** Copies one Arrow typed-array view when required by the transport copy policy. */
function splitArrowBuffer<T>(array: T, options: SplitArrowBuffersOptions): T {
  if (!isArrowTypedArray(array)) {
    return array;
  }
  if (options.copy === 'none') {
    return array;
  }
  if (
    options.copy !== 'all' &&
    array.byteOffset === 0 &&
    array.byteLength === array.buffer.byteLength
  ) {
    return array;
  }
  return array.slice() as T;
}

/** Returns whether a value is an Arrow-compatible typed-array buffer view. */
function isArrowTypedArray(value: unknown): value is ArrowTypedArray {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

/** Collects transferable buffers from one dehydrated Arrow Data tree. */
function collectDehydratedArrowDataBuffers(
  data: DehydratedArrowData,
  buffers: Set<ArrayBuffer>
): void {
  Object.values(data.buffers).forEach(value => {
    if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) {
      buffers.add(value.buffer);
    }
  });
  data.children.forEach(childData => collectDehydratedArrowDataBuffers(childData, buffers));
  data.dictionary?.data.forEach(dictionaryData =>
    collectDehydratedArrowDataBuffers(dictionaryData, buffers)
  );
}

/** Serializes an Arrow schema into a structured-cloneable schema payload. */
function serializeArrowSchema(arrowSchema: arrow.Schema): SerializableArrowSchema {
  return {
    fields: arrowSchema.fields.map(field => serializeArrowField(field)),
    metadata: serializeArrowMetadata(arrowSchema.metadata)
  };
}

/** Hydrates a structured-cloneable schema payload into an Arrow schema. */
function deserializeArrowSchema(schema: SerializableArrowSchema): arrow.Schema {
  return new arrow.Schema(
    schema.fields.map(field => deserializeArrowField(field)),
    deserializeArrowMetadata(schema.metadata)
  );
}

/** Serializes Arrow schema metadata into a structured-cloneable object. */
function serializeArrowMetadata(arrowMetadata: Map<string, string>): Record<string, string> {
  return Object.fromEntries(arrowMetadata);
}

/** Hydrates structured-cloneable schema metadata into an Arrow metadata map. */
function deserializeArrowMetadata(metadata?: Record<string, string>): Map<string, string> {
  return metadata ? new Map(Object.entries(metadata)) : new Map<string, string>();
}

/** Serializes one Arrow field into a structured-cloneable field payload. */
function serializeArrowField(field: arrow.Field): SerializableArrowField {
  return {
    name: field.name,
    type: serializeArrowType(field.type),
    nullable: field.nullable,
    metadata: serializeArrowMetadata(field.metadata)
  };
}

/** Hydrates one structured-cloneable field payload into an Arrow field. */
function deserializeArrowField(field: SerializableArrowField): arrow.Field {
  return new arrow.Field(
    field.name,
    deserializeArrowType(field.type),
    field.nullable,
    deserializeArrowMetadata(field.metadata)
  );
}

/** Serializes supported Arrow data types into version-stable type payloads. */
// eslint-disable-next-line complexity
function serializeArrowType(arrowType: arrow.DataType): SerializableArrowDataType {
  switch (arrowType.constructor) {
    case arrow.Null:
      return 'null';
    case arrow.Binary:
      return 'binary';
    case arrow.FixedSizeBinary:
      return {
        type: 'fixed-size-binary',
        byteWidth: (arrowType as arrow.FixedSizeBinary).byteWidth
      };
    case arrow.Bool:
      return 'bool';
    case arrow.Int:
      return serializeArrowIntType(arrowType as arrow.Int);
    case arrow.Int8:
      return 'int8';
    case arrow.Int16:
      return 'int16';
    case arrow.Int32:
      return 'int32';
    case arrow.Int64:
      return 'int64';
    case arrow.Uint8:
      return 'uint8';
    case arrow.Uint16:
      return 'uint16';
    case arrow.Uint32:
      return 'uint32';
    case arrow.Uint64:
      return 'uint64';
    case arrow.Float:
      return serializeArrowFloatType(arrowType as arrow.Float);
    case arrow.Float16:
      return 'float16';
    case arrow.Float32:
      return 'float32';
    case arrow.Float64:
      return 'float64';
    case arrow.Utf8:
      return 'utf8';
    case arrow.Decimal: {
      const decimal = arrowType as arrow.Decimal;
      return {
        type: 'decimal',
        bitWidth: decimal.bitWidth,
        precision: decimal.precision,
        scale: decimal.scale
      };
    }
    case arrow.Date_:
      return (arrowType as arrow.Date_).unit === arrow.DateUnit.DAY
        ? 'date-day'
        : 'date-millisecond';
    case arrow.DateDay:
      return 'date-day';
    case arrow.DateMillisecond:
      return 'date-millisecond';
    case arrow.Time:
      return serializeArrowTimeUnit((arrowType as arrow.Time).unit, 'time');
    case arrow.TimeSecond:
      return 'time-second';
    case arrow.TimeMillisecond:
      return 'time-millisecond';
    case arrow.TimeMicrosecond:
      return 'time-microsecond';
    case arrow.TimeNanosecond:
      return 'time-nanosecond';
    case arrow.Timestamp:
      return serializeArrowTimeUnit((arrowType as arrow.Timestamp).unit, 'timestamp');
    case arrow.TimestampSecond:
      return 'timestamp-second';
    case arrow.TimestampMillisecond:
      return 'timestamp-millisecond';
    case arrow.TimestampMicrosecond:
      return 'timestamp-microsecond';
    case arrow.TimestampNanosecond:
      return 'timestamp-nanosecond';
    case arrow.Interval:
      return (arrowType as arrow.Interval).unit === arrow.IntervalUnit.YEAR_MONTH
        ? 'interval-yearmonth'
        : 'interval-daytime';
    case arrow.IntervalDayTime:
      return 'interval-daytime';
    case arrow.IntervalYearMonth:
      return 'interval-yearmonth';
    case arrow.Map_: {
      const mapType = arrowType as arrow.Map_;
      return {
        type: 'map',
        keysSorted: mapType.keysSorted,
        children: mapType.children.map(field => serializeArrowField(field))
      };
    }
    case arrow.List: {
      const listType = arrowType as arrow.List;
      return {
        type: 'list',
        children: [serializeArrowField(listType.valueField)]
      };
    }
    case arrow.FixedSizeList: {
      const fixedSizeList = arrowType as arrow.FixedSizeList;
      return {
        type: 'fixed-size-list',
        listSize: fixedSizeList.listSize,
        children: [serializeArrowField(fixedSizeList.children[0])]
      };
    }
    case arrow.Struct:
      return {
        type: 'struct',
        children: (arrowType as arrow.Struct).children.map(field => serializeArrowField(field))
      };
    case arrow.Dictionary: {
      const dictionaryType = arrowType as arrow.Dictionary;
      return {
        type: 'dictionary',
        id: dictionaryType.id,
        indices: serializeArrowDictionaryKeyType(dictionaryType.indices),
        dictionary: serializeArrowType(dictionaryType.dictionary),
        isOrdered: dictionaryType.isOrdered
      };
    }
    default:
      throw new Error(
        `Arrow type not supported for worker transport: ${arrowType.constructor.name}`
      );
  }
}

/** Hydrates a serialized Arrow data type payload into an Arrow data type instance. */
// eslint-disable-next-line complexity
function deserializeArrowType(dataType: SerializableArrowDataType): arrow.DataType {
  if (typeof dataType === 'object') {
    switch (dataType.type) {
      case 'decimal':
        return new arrow.Decimal(dataType.precision, dataType.scale, dataType.bitWidth);
      case 'map':
        return new arrow.Map_(
          dataType.children.map(field => deserializeArrowField(field)) as any,
          dataType.keysSorted
        );
      case 'list':
        return new arrow.List(deserializeArrowField(dataType.children[0]));
      case 'fixed-size-list':
        return new arrow.FixedSizeList(
          dataType.listSize,
          deserializeArrowField(dataType.children[0])
        );
      case 'fixed-size-binary':
        return new arrow.FixedSizeBinary(dataType.byteWidth);
      case 'struct':
        return new arrow.Struct(dataType.children.map(field => deserializeArrowField(field)));
      case 'dictionary':
        return new arrow.Dictionary(
          deserializeArrowType(dataType.dictionary),
          deserializeArrowDictionaryKeyType(dataType.indices),
          dataType.id,
          dataType.isOrdered
        );
      default:
        throw new Error(
          `Arrow type not supported for worker transport: ${JSON.stringify(dataType)}`
        );
    }
  }

  switch (dataType) {
    case 'null':
      return new arrow.Null();
    case 'binary':
      return new arrow.Binary();
    case 'bool':
      return new arrow.Bool();
    case 'int8':
      return new arrow.Int8();
    case 'int16':
      return new arrow.Int16();
    case 'int32':
      return new arrow.Int32();
    case 'int64':
      return new arrow.Int64();
    case 'uint8':
      return new arrow.Uint8();
    case 'uint16':
      return new arrow.Uint16();
    case 'uint32':
      return new arrow.Uint32();
    case 'uint64':
      return new arrow.Uint64();
    case 'float16':
      return new arrow.Float16();
    case 'float32':
      return new arrow.Float32();
    case 'float64':
      return new arrow.Float64();
    case 'utf8':
      return new arrow.Utf8();
    case 'date-day':
      return new arrow.DateDay();
    case 'date-millisecond':
      return new arrow.DateMillisecond();
    case 'time-second':
      return new arrow.TimeSecond();
    case 'time-millisecond':
      return new arrow.TimeMillisecond();
    case 'time-microsecond':
      return new arrow.TimeMicrosecond();
    case 'time-nanosecond':
      return new arrow.TimeNanosecond();
    case 'timestamp-second':
      return new arrow.TimestampSecond();
    case 'timestamp-millisecond':
      return new arrow.TimestampMillisecond();
    case 'timestamp-microsecond':
      return new arrow.TimestampMicrosecond();
    case 'timestamp-nanosecond':
      return new arrow.TimestampNanosecond();
    case 'interval-daytime':
      return new arrow.IntervalDayTime();
    case 'interval-yearmonth':
      return new arrow.IntervalYearMonth();
    default:
      throw new Error(`Arrow type not supported for worker transport: ${dataType}`);
  }
}

/** Serializes an Arrow integer type to a supported primitive type label. */
function serializeArrowIntType(intType: arrow.Int): SerializableArrowDataType {
  const prefix = intType.isSigned ? 'int' : 'uint';
  const type = `${prefix}${intType.bitWidth}`;
  if (isSerializablePrimitiveArrowType(type)) {
    return type;
  }
  throw new Error(`Arrow int type not supported for worker transport: ${type}`);
}

/** Serializes an Arrow floating-point type to a supported primitive type label. */
function serializeArrowFloatType(floatType: arrow.Float): SerializableArrowDataType {
  switch (floatType.precision) {
    case arrow.Precision.HALF:
      return 'float16';
    case arrow.Precision.SINGLE:
      return 'float32';
    case arrow.Precision.DOUBLE:
      return 'float64';
    default:
      return 'float64';
  }
}

/** Serializes Arrow time and timestamp units to transport type labels. */
function serializeArrowTimeUnit(
  unit: arrow.TimeUnit,
  prefix: 'time' | 'timestamp'
): SerializableArrowDataType {
  switch (unit) {
    case arrow.TimeUnit.SECOND:
      return `${prefix}-second`;
    case arrow.TimeUnit.MILLISECOND:
      return `${prefix}-millisecond`;
    case arrow.TimeUnit.MICROSECOND:
      return `${prefix}-microsecond`;
    case arrow.TimeUnit.NANOSECOND:
      return `${prefix}-nanosecond`;
    default:
      return `${prefix}-second`;
  }
}

/** Serializes the supported Arrow dictionary index type. */
function serializeArrowDictionaryKeyType(arrowType: arrow.DataType): SerializableArrowKeyType {
  if (arrowType instanceof arrow.Int) {
    const prefix = arrowType.isSigned ? 'int' : 'uint';
    const keyType = `${prefix}${arrowType.bitWidth}`;
    if (isSerializableArrowKeyType(keyType)) {
      return keyType;
    }
  }

  switch (arrowType.constructor) {
    case arrow.Int8:
      return 'int8';
    case arrow.Int16:
      return 'int16';
    case arrow.Int32:
      return 'int32';
    case arrow.Uint8:
      return 'uint8';
    case arrow.Uint16:
      return 'uint16';
    case arrow.Uint32:
      return 'uint32';
    default:
      throw new Error(`Arrow dictionary index type not supported: ${arrowType.constructor.name}`);
  }
}

/** Hydrates one serialized dictionary index type into an Arrow integer type. */
function deserializeArrowDictionaryKeyType(
  keyType: SerializableArrowKeyType
): ArrowDictionaryKeyType {
  switch (keyType) {
    case 'int8':
      return new arrow.Int8();
    case 'int16':
      return new arrow.Int16();
    case 'int32':
      return new arrow.Int32();
    case 'uint8':
      return new arrow.Uint8();
    case 'uint16':
      return new arrow.Uint16();
    case 'uint32':
      return new arrow.Uint32();
    default:
      throw new Error(`Arrow dictionary index type not supported: ${keyType}`);
  }
}

/** Returns whether a string is a supported dictionary index type label. */
function isSerializableArrowKeyType(keyType: string): keyType is SerializableArrowKeyType {
  return ['int8', 'int16', 'int32', 'uint8', 'uint16', 'uint32'].includes(keyType);
}

/** Returns whether a string is a supported primitive Arrow type label. */
function isSerializablePrimitiveArrowType(
  type: string
): type is Extract<SerializableArrowDataType, string> {
  return ['int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64'].includes(type);
}

/** Returns whether a value is an Arrow IPC transport payload. */
function isSerializedArrowTableIPC(value: unknown): value is SerializedArrowTableIPC {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as SerializedArrowTableIPC).shape === 'arrow-table' &&
      (value as SerializedArrowTableIPC).transport === 'arrow-ipc'
  );
}
