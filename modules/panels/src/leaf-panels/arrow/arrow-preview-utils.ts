// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

const LUMA_MATRIX_SHAPE_KEY = 'luma.gl:matrix-shape';
const LUMA_MATRIX_ORDER_KEY = 'luma.gl:matrix-order';
const LUMA_MATRIX_LAYOUT_KEY = 'luma.gl:matrix-layout';
const LUMA_TEMPORAL_PREFIX = 'luma.gl:temporal-';

/** Arrow metadata container shape used by Apache Arrow JS schemas and fields. */
export type ArrowMetadataLike =
  | Map<string, unknown>
  | Iterable<[string, unknown]>
  | Record<string, unknown>;

/** Arrow data type subset used by the structural Arrow panel adapters. */
export type ArrowTypeLike = {
  /** Stringifies the Arrow type. */
  toString?: () => string;
  /** Child fields for nested, list, and fixed-size-list types. */
  children?: ArrowSchemaFieldLike[];
  /** Fixed-size-list item count. */
  listSize?: number;
  /** Temporal unit metadata used by Arrow timestamp/time/duration types. */
  unit?: unknown;
  /** Temporal timezone metadata used by Arrow timestamp types. */
  timezone?: string | null;
  /** Numeric bit width metadata used by Arrow integer/float types. */
  bitWidth?: number;
};

/** Arrow schema field subset used by the Arrow inspection panels. */
export type ArrowSchemaFieldLike = {
  /** Field name. */
  name?: string;
  /** Whether the field accepts null values. */
  nullable?: boolean;
  /** Arrow data type. */
  type?: string | ArrowTypeLike;
  /** Field-level metadata. */
  metadata?: ArrowMetadataLike;
};

/** Arrow schema subset used by the Arrow inspection panels. */
export type ArrowSchemaLike = {
  /** Ordered schema fields. */
  fields?: ArrowSchemaFieldLike[];
  /** Schema-level metadata. */
  metadata?: ArrowMetadataLike;
};

/** Backwards-compatible alias for Arrow table field structures. */
export type ArrowTableFieldLike = ArrowSchemaFieldLike;

/** Backwards-compatible alias for Arrow table schema structures. */
export type ArrowTableSchemaLike = ArrowSchemaLike;

/** Arrow vector subset used by {@link ArrowTablePanel}. */
export type ArrowTableVectorLike = {
  /** Vector length. */
  length?: number;
  /** Arrow vector type. */
  type?: string | ArrowTypeLike;
  /** Arrow vector data chunks. */
  data?: unknown;
  /** Returns the cell value at the supplied row index. */
  get?: (index: number) => unknown;
  /** Returns a child vector for nested values. */
  getChildAt?: (childIndex: number) => ArrowTableVectorLike | null | undefined;
  /** Materializes vector-like values. */
  toArray?: () => unknown;
};

/** Arrow record batch subset used by {@link ArrowBatchesPanel}. */
export type ArrowRecordBatchLike = {
  /** Number of rows in the batch. */
  numRows?: number;
  /** Batch length fallback used by some Arrow structures. */
  length?: number;
  /** Number of columns in the batch. */
  numCols?: number;
  /** Batch schema. */
  schema?: ArrowSchemaLike;
  /** Arrow data payload for the batch. */
  data?: {length?: number; children?: unknown[]} | unknown;
  /** Returns a column vector by index. */
  getChildAt?: (columnIndex: number) => ArrowTableVectorLike | null | undefined;
};

/** Arrow table subset used by {@link ArrowTablePanel}. */
export type ArrowTableLike = {
  /** Number of rows in the table. */
  numRows?: number;
  /** Table length fallback used by some Arrow structures. */
  length?: number;
  /** Table schema. */
  schema?: ArrowSchemaLike;
  /** Record batches that make up the table. */
  batches?: ArrowRecordBatchLike[];
  /** Arrow table data chunks. */
  data?: ArrowRecordBatchLike[] | unknown;
  /** Returns a column vector by index. */
  getChildAt?: (columnIndex: number) => ArrowTableVectorLike | null | undefined;
  /** Returns a column vector by name. */
  getChild?: (columnName: string) => ArrowTableVectorLike | null | undefined;
};

/** loaders.gl arrow-table wrapper subset accepted by the Arrow panels. */
export type ArrowTableWrapperLike = {
  /** loaders.gl structural table shape. */
  shape?: string;
  /** Wrapped Arrow table. */
  data?: ArrowTableLike | null;
};

/** Arrow table input accepted by the Arrow inspection panels. */
export type ArrowTableInput = ArrowTableLike | ArrowTableWrapperLike | null | undefined;

/** Context supplied to Arrow table column formatters. */
export type ArrowCellFormatContext = {
  /** Arrow table being formatted. */
  table: ArrowTableLike | null;
  /** Schema field for the formatted cell. */
  field: ArrowSchemaFieldLike;
  /** Dot-notation field path. */
  fieldPath: string;
  /** Preview column index. */
  columnIndex: number;
  /** Row index inside the currently previewed table or batch. */
  rowIndex: number;
  /** Absolute table row index. */
  tableRowIndex: number;
  /** Selected record batch index, when formatting a single batch. */
  batchIndex?: number;
  /** Vector used to read this cell. */
  vector?: ArrowTableVectorLike | null;
  /** Maximum nested items rendered for list-like values. */
  maxNestedItems: number;
};

/** Formatter map keyed by field path or field name. */
export type ArrowTableColumnFormatters = Record<
  string,
  (value: unknown, context: ArrowCellFormatContext) => string
>;

export type ArrowMetadataEntry = {
  key: string;
  value: string;
  isLumaMetadata: boolean;
};

export type ArrowSchemaPreview = {
  schemaMetadata: ArrowMetadataEntry[];
  fields: ArrowSchemaPreviewRow[];
};

export type ArrowSchemaPreviewRow = {
  key: string;
  name: string;
  type: string;
  nullable: string;
  metadata: ArrowMetadataEntry[];
};

export type ArrowTablePreviewOptions = {
  table: ArrowTableInput;
  maxRows: number;
  maxColumns?: number;
  showRowIndex?: boolean;
  batchIndex?: number | 'all';
  maxNestedItems?: number;
  columnFormatters?: ArrowTableColumnFormatters;
};

export type ArrowTablePreview = {
  fields: ArrowTablePreviewField[];
  rows: ArrowTablePreviewRow[];
  numRows: number;
  rowsToRender: number;
  omittedRows: number;
  omittedColumns: number;
  batchLabel?: string;
};

export type ArrowTablePreviewField = {
  key: string;
  label: string;
  path: string;
  schemaField?: ArrowSchemaFieldLike;
};

export type ArrowTablePreviewRow = {
  key: string;
  cells: ArrowTablePreviewCell[];
};

export type ArrowTablePreviewCell = {
  key: string;
  value: string;
};

export type ArrowBatchPreview = {
  rows: ArrowBatchPreviewRow[];
  batchCount: number;
  rowCount: number;
};

export type ArrowBatchPreviewRow = {
  key: string;
  index: number;
  rowCount: number;
  rowRange: string;
  columnCount: number;
  selected: boolean;
};

type NormalizedField = {
  key: string;
  label: string;
  path: string;
  pathIndices: number[];
  topLevelIndex: number;
  field: ArrowSchemaFieldLike;
};

/** Unwraps Apache Arrow tables and loaders.gl `{shape: 'arrow-table', data}` wrappers. */
export function getArrowTable(input: ArrowTableInput): ArrowTableLike | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  if ((input as ArrowTableWrapperLike).shape === 'arrow-table') {
    return (input as ArrowTableWrapperLike).data ?? null;
  }

  return input as ArrowTableLike;
}

/** Returns the schema attached to an Arrow table or its first batch. */
export function getArrowTableSchema(input: ArrowTableInput): ArrowSchemaLike | null {
  const table = getArrowTable(input);
  return table?.schema ?? getArrowRecordBatches(input)[0]?.schema ?? null;
}

/** Returns the row count for an Arrow table-like object. */
export function getArrowTableRowCount(input: ArrowTableInput): number {
  const table = getArrowTable(input);
  if (!table) {
    return 0;
  }

  const explicitRowCount = toOptionalNonNegativeInteger(table.numRows ?? table.length);
  if (explicitRowCount !== undefined) {
    return explicitRowCount;
  }

  return getArrowRecordBatches(table).reduce(
    (rowCount, batch) => rowCount + getArrowBatchRowCount(batch),
    0
  );
}

/** Returns structural record batches for an Arrow table, synthesizing one batch when needed. */
export function getArrowRecordBatches(input: ArrowTableInput): ArrowRecordBatchLike[] {
  const table = getArrowTable(input);
  if (!table) {
    return [];
  }

  if (Array.isArray(table.batches)) {
    return table.batches;
  }

  if (Array.isArray(table.data)) {
    return table.data.map(data => ({
      data,
      length: getDataLength(data),
      schema: table.schema
    }));
  }

  const rowCount = toOptionalNonNegativeInteger(table.numRows ?? table.length) ?? 0;
  return rowCount > 0 ? [{numRows: rowCount, schema: table.schema}] : [];
}

/** Builds display rows for Arrow record batch inspection. */
export function createArrowBatchPreview(
  tableInput: ArrowTableInput,
  selectedBatchIndex?: number
): ArrowBatchPreview {
  const table = getArrowTable(tableInput);
  const batches = getArrowRecordBatches(tableInput);
  let nextStartRow = 0;

  const rows = batches.map((batch, index) => {
    const rowCount = getArrowBatchRowCount(batch);
    const startRow = nextStartRow;
    const endRow = startRow + rowCount - 1;
    nextStartRow += rowCount;

    return {
      key: `batch-${index}`,
      index,
      rowCount,
      rowRange: rowCount > 0 ? `${startRow.toLocaleString()}-${endRow.toLocaleString()}` : '',
      columnCount: getArrowBatchColumnCount(batch, table),
      selected: selectedBatchIndex === index
    };
  });

  return {
    rows,
    batchCount: rows.length,
    rowCount: nextStartRow
  };
}

/** Builds display rows for Arrow schema fields and metadata. */
export function createArrowSchemaPreview(
  schema: ArrowSchemaLike | null | undefined
): ArrowSchemaPreview {
  return {
    schemaMetadata: normalizeArrowMetadata(schema?.metadata),
    fields: (schema?.fields ?? []).map((field, index) => ({
      key: `${field.name || 'field'}-${index}`,
      name: field.name || `field_${index}`,
      type: formatArrowFieldType(field.type),
      nullable: field.nullable ? 'yes' : 'no',
      metadata: collectArrowFieldMetadata(field)
    }))
  };
}

/** Builds a bounded row model so rendering never walks the full table by default. */
export function createArrowTablePreview({
  table: tableInput,
  maxRows,
  maxColumns,
  showRowIndex = false,
  batchIndex = 'all',
  maxNestedItems = 8,
  columnFormatters
}: ArrowTablePreviewOptions): ArrowTablePreview {
  const table = getArrowTable(tableInput);
  const schema = getArrowTableSchema(table);
  const fields = buildPreviewFields(schema?.fields ?? []);
  const columnsToRender = Math.min(fields.length, toLimit(maxColumns, fields.length));
  const renderedFields = fields.slice(0, columnsToRender);
  const batchSelection = getBatchSelection(table, batchIndex);
  const numRows = batchSelection?.rowCount ?? getArrowTableRowCount(table);
  const rowsToRender = Math.min(numRows, toLimit(maxRows, numRows));
  const fieldPreviews: ArrowTablePreviewField[] = [
    ...(showRowIndex ? [{key: 'row-index', label: '#', path: '#'}] : []),
    ...renderedFields.map(field => ({
      key: field.key,
      label: field.label,
      path: field.path,
      schemaField: field.field
    }))
  ];

  return {
    fields: fieldPreviews,
    rows: Array.from({length: rowsToRender}, (_row, rowIndex) => {
      const tableRowIndex = rowIndex + (batchSelection?.startRow ?? 0);
      return {
        key: `row-${tableRowIndex}`,
        cells: [
          ...(showRowIndex
            ? [{key: `row-index-${tableRowIndex}`, value: tableRowIndex.toLocaleString()}]
            : []),
          ...renderedFields.map((field, columnIndex) => {
            const vector = getFieldVector(table, batchSelection?.batch, field);
            const vectorRowIndex = batchSelection?.batchHasVectors ? rowIndex : tableRowIndex;
            const value = vector?.get?.(vectorRowIndex);
            const context: ArrowCellFormatContext = {
              table,
              field: field.field,
              fieldPath: field.path,
              columnIndex,
              rowIndex,
              tableRowIndex,
              batchIndex: batchSelection?.index,
              vector,
              maxNestedItems: toLimit(maxNestedItems, 8)
            };
            const formatter = getColumnFormatter(columnFormatters, field);

            return {
              key: `${field.key}-${tableRowIndex}`,
              value: formatter ? formatter(value, context) : formatArrowCellValue(value, context)
            };
          })
        ]
      };
    }),
    numRows,
    rowsToRender,
    omittedRows: Math.max(0, numRows - rowsToRender),
    omittedColumns: Math.max(0, fields.length - columnsToRender),
    batchLabel: batchSelection ? `batch ${batchSelection.index}` : undefined
  };
}

/** Normalizes row counts and limits to finite non-negative integers. */
export function toNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

/** Formats row counts for panel summaries. */
export function formatArrowRowCount(rowCount: number): string {
  return `${rowCount.toLocaleString()} ${rowCount === 1 ? 'row' : 'rows'}`;
}

/** Formats column counts for panel summaries. */
export function formatArrowColumnCount(columnCount: number): string {
  return `${columnCount.toLocaleString()} ${columnCount === 1 ? 'column' : 'columns'}`;
}

/** Formats an Arrow field type without depending on a specific Arrow JS class. */
export function formatArrowFieldType(type: ArrowSchemaFieldLike['type']): string {
  if (typeof type === 'string') {
    return type;
  }
  return type?.toString?.() || 'unknown';
}

/** Converts Arrow metadata maps or objects into display entries. */
export function normalizeArrowMetadata(
  metadata: ArrowMetadataLike | null | undefined,
  keyPrefix?: string
): ArrowMetadataEntry[] {
  if (!metadata || typeof metadata !== 'object') {
    return [];
  }

  const entries =
    metadata instanceof Map
      ? [...metadata.entries()]
      : isIterableMetadata(metadata)
        ? [...metadata]
        : Object.entries(metadata);

  return entries
    .filter((entry): entry is [string, unknown] => Array.isArray(entry) && entry.length >= 2)
    .map(([key, value]) => {
      const displayKey = keyPrefix ? `${keyPrefix}.${key}` : key;
      return {
        key: displayKey,
        value: formatArrowMetadataValue(value),
        isLumaMetadata: isLumaMetadataKey(displayKey)
      };
    });
}

/** Formats arbitrary Arrow cell values for compact display. */
export function formatArrowCellValue(value: unknown, context: ArrowCellFormatContext): string {
  if (value === null || value === undefined) {
    return '';
  }

  const matrixMetadata = getLumaMatrixMetadata(context.field);
  if (matrixMetadata) {
    return formatMatrixValue(value, matrixMetadata, context.maxNestedItems);
  }

  if (isTemporalField(context.field)) {
    return formatTemporalValue(value, context);
  }

  return formatValue(value, context);
}

function getArrowBatchRowCount(batch: ArrowRecordBatchLike): number {
  return (
    toOptionalNonNegativeInteger(batch.numRows ?? batch.length) ?? getDataLength(batch.data) ?? 0
  );
}

function getArrowBatchColumnCount(
  batch: ArrowRecordBatchLike,
  table: ArrowTableLike | null
): number {
  return (
    toOptionalNonNegativeInteger(batch.numCols) ??
    batch.schema?.fields?.length ??
    table?.schema?.fields?.length ??
    getDataChildrenLength(batch.data) ??
    0
  );
}

function getDataLength(data: unknown): number | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  return toOptionalNonNegativeInteger((data as {length?: number}).length);
}

function getDataChildrenLength(data: unknown): number | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  const children = (data as {children?: unknown[]}).children;
  return Array.isArray(children) ? children.length : undefined;
}

function buildPreviewFields(fields: ArrowSchemaFieldLike[]): NormalizedField[] {
  const normalizedFields: NormalizedField[] = [];

  fields.forEach((field, topLevelIndex) => {
    collectPreviewFields({
      field,
      pathNames: [field.name || `column_${topLevelIndex}`],
      pathIndices: [topLevelIndex],
      topLevelIndex,
      normalizedFields
    });
  });

  return normalizedFields;
}

function collectPreviewFields({
  field,
  pathNames,
  pathIndices,
  topLevelIndex,
  normalizedFields
}: {
  field: ArrowSchemaFieldLike;
  pathNames: string[];
  pathIndices: number[];
  topLevelIndex: number;
  normalizedFields: NormalizedField[];
}): void {
  const children = getTypeChildren(field.type);

  if (isStructField(field) && children.length > 0) {
    children.forEach((child, childIndex) => {
      collectPreviewFields({
        field: child,
        pathNames: [...pathNames, child.name || `field_${childIndex}`],
        pathIndices: [...pathIndices, childIndex],
        topLevelIndex,
        normalizedFields
      });
    });
    return;
  }

  const path = pathNames.join('.');
  normalizedFields.push({
    key: `${path}-${pathIndices.join('-')}`,
    label: path,
    path,
    pathIndices,
    topLevelIndex,
    field
  });
}

function getTypeChildren(type: ArrowSchemaFieldLike['type']): ArrowSchemaFieldLike[] {
  return typeof type === 'object' && Array.isArray(type.children) ? type.children : [];
}

function isStructField(field: ArrowSchemaFieldLike): boolean {
  const typeName = formatArrowFieldType(field.type).toLowerCase();
  const hasChildren = getTypeChildren(field.type).length > 0;
  const typeObject = typeof field.type === 'object' ? field.type : null;

  return (
    (typeName.includes('struct') && !typeName.includes('list')) ||
    (hasChildren && !typeName.includes('list') && typeObject?.listSize === undefined)
  );
}

function getBatchSelection(
  table: ArrowTableLike | null,
  batchIndex: number | 'all'
):
  | {
      batch: ArrowRecordBatchLike;
      index: number;
      startRow: number;
      rowCount: number;
      batchHasVectors: boolean;
    }
  | undefined {
  if (!table || batchIndex === 'all') {
    return undefined;
  }

  const batches = getArrowRecordBatches(table);
  if (batchIndex < 0 || batchIndex >= batches.length) {
    return undefined;
  }

  const startRow = batches
    .slice(0, batchIndex)
    .reduce((rowCount, batch) => rowCount + getArrowBatchRowCount(batch), 0);
  const batch = batches[batchIndex];
  if (!batch) {
    return undefined;
  }

  return {
    batch,
    index: batchIndex,
    startRow,
    rowCount: getArrowBatchRowCount(batch),
    batchHasVectors: typeof batch.getChildAt === 'function'
  };
}

function getFieldVector(
  table: ArrowTableLike | null,
  batch: ArrowRecordBatchLike | undefined,
  field: NormalizedField
): ArrowTableVectorLike | null | undefined {
  const topLevelName =
    field.pathIndices.length === 1 ? field.label : field.path.split('.')[0] || field.label;
  const topLevelVector =
    batch?.getChildAt?.(field.topLevelIndex) ??
    table?.getChildAt?.(field.topLevelIndex) ??
    table?.getChild?.(topLevelName);

  return field.pathIndices
    .slice(1)
    .reduce<ArrowTableVectorLike | null | undefined>(
      (vector, childIndex) => vector?.getChildAt?.(childIndex),
      topLevelVector
    );
}

function getColumnFormatter(
  formatters: ArrowTableColumnFormatters | undefined,
  field: NormalizedField
): ((value: unknown, context: ArrowCellFormatContext) => string) | undefined {
  return formatters?.[field.path] ?? formatters?.[field.field.name ?? ''];
}

function collectArrowFieldMetadata(field: ArrowSchemaFieldLike): ArrowMetadataEntry[] {
  return [
    ...normalizeArrowMetadata(field.metadata),
    ...collectArrowChildMetadata(field, field.name || 'value')
  ];
}

function collectArrowChildMetadata(
  field: ArrowSchemaFieldLike,
  path: string
): ArrowMetadataEntry[] {
  const children = getTypeChildren(field.type);

  return children.flatMap((child, childIndex) => {
    const childPath = `${path}.${child.name || `field_${childIndex}`}`;
    return [
      ...normalizeArrowMetadata(child.metadata, childPath),
      ...collectArrowChildMetadata(child, childPath)
    ];
  });
}

function getLumaMatrixMetadata(
  field: ArrowSchemaFieldLike
): {shape: string; order?: string; layout?: string} | null {
  const metadata = collectArrowFieldMetadata(field);
  const shape = getMetadataEntryValue(metadata, LUMA_MATRIX_SHAPE_KEY);

  if (!shape) {
    return null;
  }

  return {
    shape,
    order: getMetadataEntryValue(metadata, LUMA_MATRIX_ORDER_KEY),
    layout: getMetadataEntryValue(metadata, LUMA_MATRIX_LAYOUT_KEY)
  };
}

function getMetadataEntryValue(
  metadata: ArrowMetadataEntry[],
  metadataKey: string
): string | undefined {
  return metadata.find(entry => entry.key === metadataKey || entry.key.endsWith(`.${metadataKey}`))
    ?.value;
}

function isTemporalField(field: ArrowSchemaFieldLike): boolean {
  const typeName = formatArrowFieldType(field.type).toLowerCase();
  const metadata = collectArrowFieldMetadata(field);

  return (
    metadata.some(entry => entry.key.includes(LUMA_TEMPORAL_PREFIX)) ||
    ['date', 'time', 'timestamp', 'duration'].some(type => typeName.includes(type)) ||
    getTypeChildren(field.type).some(child => isTemporalField(child))
  );
}

function formatMatrixValue(
  value: unknown,
  metadata: {shape: string; order?: string; layout?: string},
  maxNestedItems: number
): string {
  const descriptors = [metadata.order, metadata.layout].filter(Boolean).join(', ');
  const prefix = descriptors ? `${metadata.shape} (${descriptors})` : metadata.shape;
  return `${prefix} ${formatArrayPreview(value, maxNestedItems)}`;
}

function formatTemporalValue(value: unknown, context: ArrowCellFormatContext): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (isListLikeValue(value)) {
    return formatArrayPreview(value, context.maxNestedItems, context);
  }

  const unit = inferTemporalUnit(context.field);
  const formattedValue = formatValue(value, context);
  return unit ? `${formattedValue} ${unit}` : formattedValue;
}

function inferTemporalUnit(field: ArrowSchemaFieldLike): string | undefined {
  const metadataUnit = getMetadataEntryValue(
    collectArrowFieldMetadata(field),
    'luma.gl:temporal-unit'
  );
  if (metadataUnit) {
    return metadataUnit;
  }

  const typeObject = typeof field.type === 'object' ? field.type : null;
  if (typeObject?.unit !== undefined) {
    return String(typeObject.unit);
  }

  const typeName = formatArrowFieldType(field.type).toLowerCase();
  if (typeName.includes('millisecond')) {
    return 'ms';
  }
  if (typeName.includes('microsecond')) {
    return 'us';
  }
  if (typeName.includes('nanosecond')) {
    return 'ns';
  }
  if (typeName.includes('second')) {
    return 's';
  }
  if (typeName.includes('day')) {
    return 'days';
  }
  return undefined;
}

function formatValue(value: unknown, context: ArrowCellFormatContext): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toString() : formatFloat(value);
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  if (isListLikeField(context.field) && isListLikeValue(value)) {
    return formatArrayPreview(value, context.maxNestedItems, context);
  }

  if (hasToArray(value)) {
    return stringifyCellValue(value.toArray());
  }

  if (isArrayLikeValue(value)) {
    return formatArrayPreview(value, context.maxNestedItems, context);
  }

  return stringifyCellValue(value);
}

function isListLikeField(field: ArrowSchemaFieldLike): boolean {
  const typeName = formatArrowFieldType(field.type).toLowerCase();
  return (
    typeName.includes('list') ||
    (typeof field.type === 'object' && field.type.listSize !== undefined)
  );
}

function isListLikeValue(value: unknown): boolean {
  return (
    Array.isArray(value) ||
    hasVectorGet(value) ||
    hasToArray(value) ||
    isArrayLikeValue(value) ||
    isIterableValue(value)
  );
}

function formatArrayPreview(
  value: unknown,
  maxNestedItems: number,
  context?: ArrowCellFormatContext
): string {
  const itemLimit = toLimit(maxNestedItems, 8);
  const preview = getArrayPreviewItems(value, itemLimit);
  const displayedItems = preview.items.map(item =>
    isListLikeValue(item)
      ? formatArrayPreview(item, maxNestedItems, context)
      : formatNestedScalar(item, context)
  );
  const omitted = preview.omittedCount > 0 ? [`... +${preview.omittedCount}`] : [];
  return `[${[...displayedItems, ...omitted].join(', ')}]`;
}

function getArrayPreviewItems(
  value: unknown,
  itemLimit: number
): {items: unknown[]; omittedCount: number} {
  if (value === null || value === undefined) {
    return {items: [], omittedCount: 0};
  }

  if (Array.isArray(value)) {
    return {
      items: value.slice(0, itemLimit),
      omittedCount: Math.max(0, value.length - itemLimit)
    };
  }

  if (hasVectorGet(value)) {
    const length = toOptionalNonNegativeInteger(value.length) ?? itemLimit;
    return {
      items: Array.from({length: Math.min(length, itemLimit)}, (_item, index) => value.get(index)),
      omittedCount: Math.max(0, length - itemLimit)
    };
  }

  if (isArrayLikeValue(value)) {
    const length = toOptionalNonNegativeInteger(value.length) ?? 0;
    return {
      items: Array.from({length: Math.min(length, itemLimit)}, (_item, index) => value[index]),
      omittedCount: Math.max(0, length - itemLimit)
    };
  }

  if (hasToArray(value)) {
    return getArrayPreviewItems(value.toArray(), itemLimit);
  }

  if (isIterableValue(value)) {
    const items: unknown[] = [];
    const iterator = value[Symbol.iterator]();
    let next = iterator.next();
    while (!next.done && items.length < itemLimit) {
      items.push(next.value);
      next = iterator.next();
    }
    return {
      items,
      omittedCount: next.done ? 0 : 1
    };
  }

  return {items: [value], omittedCount: 0};
}

function formatNestedScalar(value: unknown, context?: ArrowCellFormatContext): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toString() : formatFloat(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'object') {
    return stringifyCellValue(value);
  }
  return String(value);
}

function formatFloat(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(6)).toString() : String(value);
}

function formatArrowMetadataValue(value: unknown): string {
  if (typeof value === 'string') {
    const parsedValue = parseJsonValue(value);
    return parsedValue === undefined ? value : stringifyMetadataValue(parsedValue);
  }
  return stringifyMetadataValue(value);
}

function parseJsonValue(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function stringifyMetadataValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, bigintReplacer, 2);
  }
  return String(value);
}

function stringifyCellValue(value: unknown): string {
  return JSON.stringify(value, bigintReplacer);
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function isLumaMetadataKey(key: string): boolean {
  return key.includes('luma.gl:');
}

function isIterableMetadata(metadata: object): metadata is Iterable<[string, unknown]> {
  return (
    Symbol.iterator in metadata &&
    typeof (metadata as {[Symbol.iterator]?: unknown})[Symbol.iterator] === 'function'
  );
}

function hasToArray(value: unknown): value is {toArray: () => unknown} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toArray' in value &&
    typeof (value as {toArray?: unknown}).toArray === 'function'
  );
}

function hasVectorGet(value: unknown): value is {length?: number; get: (index: number) => unknown} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'get' in value &&
    typeof (value as {get?: unknown}).get === 'function'
  );
}

function isArrayLikeValue(value: unknown): value is ArrayLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {length?: unknown}).length === 'number' &&
    typeof value !== 'function'
  );
}

function isIterableValue(value: unknown): value is Iterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.iterator in value &&
    typeof (value as {[Symbol.iterator]?: unknown})[Symbol.iterator] === 'function'
  );
}

function toOptionalNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : undefined;
}

function toLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}
