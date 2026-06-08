import * as arrow from 'apache-arrow';
import {describe, expect, it} from 'vitest';

import {
  chromeTraceEventArrowSchema,
  parseChromeTraceToArrowRecordBatches,
  parseChromeTraceToArrowTable
} from './index';

import type {ChromeTraceEventArrowColumns} from './chrome-trace-arrow-schema';
import type {ChromeTraceFileSchema} from './chrome-trace-schema';

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
}

/**
 * Builds a compact Chrome trace fixture that exercises the Arrow parser edge cases.
 */
function createChromeTraceFixture(): ChromeTraceFileSchema {
  return {
    displayTimeUnit: 'us',
    metadata: {
      source: 'unit-test',
      version: 1
    },
    traceEvents: [
      {
        name: 'process_name',
        ph: 'M',
        pid: 7,
        tid: 'main',
        args: {name: 'proc-7'}
      },
      {
        name: 'complete-span',
        ph: 'X',
        ts: 100,
        pid: 7,
        tid: 'main',
        cat: 'blink',
        dur: 25,
        args: {nested: {ok: true}},
        id2: {global: 'g-1'},
        custom_flag: true
      },
      {
        name: 'flow-start',
        ph: 's',
        ts: 200,
        pid: '8',
        tid: 9,
        id: 'flow-1',
        bind_id: 42,
        s: 'p'
      },
      {
        name: 'instant-no-args',
        ph: 'i',
        ts: 250,
        pid: '8',
        tid: 9
      }
    ]
  };
}

/**
 * Encodes one Chrome trace fixture into an ArrayBuffer for direct Arrow parsing.
 */
function encodeChromeTraceFixture(traceFile: ChromeTraceFileSchema): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(traceFile));
  return copyBytesToArrayBuffer(bytes);
}

/**
 * Splits one Chrome trace fixture into small ArrayBuffer chunks for batched parsing.
 */
async function* streamChromeTraceFixture(
  traceFile: ChromeTraceFileSchema
): AsyncIterable<ArrayBuffer> {
  const text = JSON.stringify(traceFile);
  for (let startIndex = 0; startIndex < text.length; startIndex += 37) {
    const slice = text.slice(startIndex, startIndex + 37);
    const bytes = new TextEncoder().encode(slice);
    yield copyBytesToArrayBuffer(bytes);
  }
}

describe('Chrome trace Arrow parser', () => {
  it('exports a stable Arrow schema contract', () => {
    expect(chromeTraceEventArrowSchema.fields.map(field => field.name)).toEqual([
      'name',
      'ph',
      'ts',
      'pid',
      'tid',
      'cat',
      'dur',
      'tdur',
      'tts',
      'id',
      'bind_id',
      'scope',
      'args',
      'extraJson'
    ]);
    expect(chromeTraceEventArrowSchema.fields.map(field => field.nullable)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true
    ]);
    expect(chromeTraceEventArrowSchema.fields.map(field => field.type.typeId)).toEqual([
      new arrow.Utf8().typeId,
      new arrow.Utf8().typeId,
      new arrow.Float64().typeId,
      new arrow.Utf8().typeId,
      new arrow.Utf8().typeId,
      new arrow.Utf8().typeId,
      new arrow.Float64().typeId,
      new arrow.Float64().typeId,
      new arrow.Float64().typeId,
      new arrow.Utf8().typeId,
      new arrow.Utf8().typeId,
      new arrow.Utf8().typeId,
      new arrow.Utf8().typeId,
      new arrow.Utf8().typeId
    ]);
  });

  it('parses a full Chrome trace into an Arrow table with encoded args and schema metadata', () => {
    const traceFile = createChromeTraceFixture();
    const table = parseChromeTraceToArrowTable(encodeChromeTraceFixture(traceFile));

    expect(table.numRows).toBe(4);
    expect(table.schema.metadata.get('chromeTrace.displayTimeUnit')).toBe('us');
    expect(table.schema.metadata.get('chromeTrace.metadataJson')).toBe(
      JSON.stringify(traceFile.metadata)
    );
    expect(table.getChild('pid')?.get(0)).toBe('7');
    expect(table.getChild('tid')?.get(0)).toBe('main');
    expect(table.getChild('args')?.get(1)).toBe('{"nested":{"ok":true}}');
    expect(table.getChild('args')?.get(3)).toBeNull();
    expect(table.getChild('scope')?.get(2)).toBe('p');

    const extraJson = table.getChild('extraJson')?.get(1);
    expect(typeof extraJson).toBe('string');
    expect(JSON.parse(extraJson as string)).toEqual({
      pid: 7,
      id2: {global: 'g-1'},
      custom_flag: true
    });
  });

  it('emits Arrow record batches whose concatenation matches the full Arrow table rows', async () => {
    const traceFile = createChromeTraceFixture();
    const table = parseChromeTraceToArrowTable(encodeChromeTraceFixture(traceFile));
    const batches: arrow.RecordBatch[] = [];

    for await (const batch of parseChromeTraceToArrowRecordBatches(
      streamChromeTraceFixture(traceFile),
      {
        batchSize: 2
      }
    )) {
      batches.push(batch as arrow.RecordBatch);
    }

    expect(batches).toHaveLength(2);

    const combinedTable = new arrow.Table(batches[0]!.schema, batches);
    expect(combinedTable.numRows).toBe(table.numRows);
    expect(combinedTable.schema.fields.map(field => field.name)).toEqual(
      table.schema.fields.map(field => field.name)
    );

    const fieldNames = table.schema.fields.map(
      field => field.name as keyof ChromeTraceEventArrowColumns
    );
    for (const fieldName of fieldNames) {
      const expectedValues = Array.from({length: table.numRows}, (_, rowIndex) =>
        table.getChild(fieldName)?.get(rowIndex)
      );
      const actualValues = Array.from({length: combinedTable.numRows}, (_, rowIndex) =>
        combinedTable.getChild(fieldName)?.get(rowIndex)
      );
      expect(actualValues).toEqual(expectedValues);
    }
  });

  it('does not re-emit tokenized rows when a final metadata-only chunk completes the JSON file', async () => {
    const traceFile = createChromeTraceFixture();
    const traceEventsJson = JSON.stringify(traceFile.traceEvents);
    const metadataJson = JSON.stringify(traceFile.metadata);
    const batches: arrow.RecordBatch[] = [];

    async function* source(): AsyncIterable<ArrayBuffer> {
      const chunks = [
        `{"displayTimeUnit":"us","traceEvents":${traceEventsJson}`,
        `,"metadata":${metadataJson}}`
      ];
      for (const chunk of chunks) {
        const bytes = new TextEncoder().encode(chunk);
        yield copyBytesToArrayBuffer(bytes);
      }
    }

    for await (const batch of parseChromeTraceToArrowRecordBatches(source(), {
      batchSize: 2
    })) {
      batches.push(batch as arrow.RecordBatch);
    }

    const combinedTable = new arrow.Table(batches[0]!.schema, batches);
    expect(combinedTable.numRows).toBe(traceFile.traceEvents.length);

    const finalBatch = batches[batches.length - 1];
    expect(finalBatch?.schema.metadata.get('chromeTrace.metadataJson')).toBe(metadataJson);
  });
});
