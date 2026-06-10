import {describe, expect, it} from 'vitest';

import {
  consumeChromeTraceArrowStream,
  consumeChromeTraceEventStream,
  consumeChromeTraceFileStream,
  streamChromeTraceArrowChunks,
  streamChromeTraceFileChunks
} from './chrome-trace-stream';
import {
  parseChromeTraceToArrowRecordBatches,
  parseChromeTraceToArrowTable
} from './loaders/chrome-trace-loader/chrome-trace-arrow-parser';
import {createTraceStreamSession} from './trace-stream-session';

import type {ChromeTraceArrowSourceItem} from './loaders/chrome-trace-loader/chrome-trace-arrow-adapter';
import type {
  ChromeTraceEventSchema,
  ChromeTraceFileSchema
} from './loaders/chrome-trace-loader/chrome-trace-schema';
import type {TraceSpanId} from './trace-graph/trace-types';
import type {TraceStreamChunk} from './trace-stream-session';

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
}

/** Creates one minimal Chrome trace metadata event. */
function createMetadataEvent(
  name: 'process_name' | 'thread_name',
  tid: number,
  args: Record<string, unknown>
): ChromeTraceEventSchema {
  return {
    name,
    ph: 'M',
    ts: 0,
    pid: 1,
    tid,
    args
  };
}

/** Creates one minimal complete-duration Chrome trace span event. */
function createCompleteSpanEvent(name: string, ts: number, dur: number): ChromeTraceEventSchema {
  return {
    name,
    ph: 'X',
    ts,
    dur,
    pid: 1,
    tid: 1,
    cat: 'blink',
    args: {}
  };
}

/** Builds one compact Chrome trace file fixture for streaming tests. */
function createChromeTraceFixture(): ChromeTraceFileSchema {
  return {
    displayTimeUnit: 'us',
    metadata: {
      stream: true
    },
    traceEvents: [
      createMetadataEvent('process_name', 0, {name: 'proc-1'}),
      createMetadataEvent('thread_name', 1, {name: 'main'}),
      {
        name: 'async-start',
        ph: 'b',
        ts: 200,
        pid: 'worker',
        tid: 7,
        id: 77,
        s: 'p'
      },
      createCompleteSpanEvent('span-1', 1_000, 2_000),
      createCompleteSpanEvent('span-2', 4_000, 1_000)
    ]
  };
}

/** Encodes one Chrome trace fixture into an ArrayBuffer. */
function encodeChromeTraceFixture(traceFile: ChromeTraceFileSchema): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(traceFile));
  return copyBytesToArrayBuffer(bytes);
}

/** Streams one Chrome trace fixture in small ArrayBuffer chunks. */
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

/** Parses one Chrome trace fixture into an Arrow table through the public parser API. */
async function parseChromeTraceArrowTable(traceFile: ChromeTraceFileSchema) {
  return parseChromeTraceToArrowTable(encodeChromeTraceFixture(traceFile));
}

/** Parses one streamed Chrome trace fixture into Arrow record batches through the public parser API. */
async function parseChromeTraceArrowBatches(traceFile: ChromeTraceFileSchema, batchSize: number) {
  const batches: ChromeTraceArrowSourceItem[] = [];
  for await (const batch of parseChromeTraceToArrowRecordBatches(
    streamChromeTraceFixture(traceFile),
    {batchSize}
  )) {
    batches.push(batch as ChromeTraceArrowSourceItem);
  }
  return batches;
}

/** Creates a compact comparable summary for one streamed replacement chunk sequence. */
function summarizeChunks(chunks: TraceStreamChunk[]): unknown[] {
  return chunks.map(chunk => ({
    name: chunk.name,
    processCount: chunk.replaceSnapshot?.processes.length,
    processNames: chunk.replaceSnapshot?.processes.map(process => process.name),
    crossDependencyCount: chunk.replaceSnapshot?.crossDependencies.length
  }));
}

describe('chrome-trace-stream', () => {
  it('publishes replacement snapshots while consuming parsed event streams', async () => {
    const session = createTraceStreamSession({publishIntervalMs: 0});
    const snapshots: number[] = [];
    session.subscribe(snapshot => {
      snapshots.push(snapshot.sequence);
    });

    async function* source() {
      yield [
        createMetadataEvent('process_name', 0, {name: 'proc-1'}),
        createMetadataEvent('thread_name', 1, {name: 'main'})
      ];
      yield createCompleteSpanEvent('span-1', 1_000, 2_000);
      yield createCompleteSpanEvent('span-2', 4_000, 1_000);
    }

    const snapshot = await consumeChromeTraceEventStream(session, source(), {
      name: 'streamed-events',
      publishEveryEvents: 1
    });

    expect(
      snapshot?.traceGraph.getSpanRefByExternalBlockId('span:1:1:span-2:4:5' as TraceSpanId)
    ).toBeDefined();
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
  });

  it('tokenizes chunked Chrome trace files and publishes the final snapshot', async () => {
    const session = createTraceStreamSession({publishIntervalMs: 0});
    const chunks = [
      '{"displayTimeUnit":"us","traceEvents":[{"name":"process_name","ph":"M","ts":0,"pid":1,',
      '"tid":0,"args":{"name":"proc-1"}},{"name":"thread_name","ph":"M","ts":0,"pid":1,"tid":1,',
      '"args":{"name":"main"}},{"name":"span-1","ph":"X","ts":1000,"dur":2000,"pid":1,"tid":1,',
      '"cat":"blink","args":{}}]}'
    ];

    async function* source() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }

    const snapshot = await consumeChromeTraceFileStream(session, source(), {
      name: 'streamed-file',
      publishEveryEvents: 1
    });

    expect(snapshot?.traceGraphData.name).toBe('streamed-file');
    expect(
      snapshot?.traceGraph.getSpanRefByExternalBlockId('span:1:1:span-1:1:3' as TraceSpanId)
    ).toBeDefined();
  });

  it('streams Chrome trace files whose metadata events omit timestamps', async () => {
    const session = createTraceStreamSession({publishIntervalMs: 0});
    const chunks = [
      '{"displayTimeUnit":"us","traceEvents":[{"name":"process_name","ph":"M","pid":1,',
      '"tid":0,"args":{"name":"proc-1"}},{"name":"thread_name","ph":"M","pid":1,"tid":1,',
      '"args":{"name":"main"}},{"name":"span-1","ph":"X","ts":1000,"dur":2000,"pid":1,"tid":1,',
      '"cat":"blink","args":{}}]}'
    ];

    async function* source() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }

    const snapshot = await consumeChromeTraceFileStream(session, source(), {
      name: 'streamed-file-metadata-without-ts',
      publishEveryEvents: 1
    });

    expect(
      snapshot?.traceGraph.getSpanRefByExternalBlockId('span:1:1:span-1:1:3' as TraceSpanId)
    ).toBeDefined();
  });

  it('routes file streaming through the Arrow parser and matches the Arrow chunk path', async () => {
    const traceFile = createChromeTraceFixture();
    const fileChunks: TraceStreamChunk[] = [];
    const arrowChunks: TraceStreamChunk[] = [];
    const arrowBatches = await parseChromeTraceArrowBatches(traceFile, 2);

    for await (const chunk of streamChromeTraceFileChunks(streamChromeTraceFixture(traceFile), {
      name: 'streamed-file',
      publishEveryEvents: 1,
      batchSize: 2
    })) {
      fileChunks.push(chunk);
    }

    async function* batchSource(): AsyncIterable<ChromeTraceArrowSourceItem> {
      for (const batch of arrowBatches) {
        yield batch;
      }
    }

    for await (const chunk of streamChromeTraceArrowChunks(batchSource(), {
      name: 'streamed-file',
      publishEveryEvents: 1
    })) {
      arrowChunks.push(chunk);
    }

    expect(summarizeChunks(fileChunks)).toEqual(summarizeChunks(arrowChunks));
  });

  it('publishes equivalent snapshots for file and Arrow stream consumption', async () => {
    const traceFile = createChromeTraceFixture();
    const fileSession = createTraceStreamSession({publishIntervalMs: 0});
    const arrowSession = createTraceStreamSession({publishIntervalMs: 0});
    const arrowBatches = await parseChromeTraceArrowBatches(traceFile, 2);

    const fileSnapshot = await consumeChromeTraceFileStream(
      fileSession,
      streamChromeTraceFixture(traceFile),
      {
        name: 'streamed-file',
        publishEveryEvents: 1,
        batchSize: 2
      }
    );

    async function* batchSource(): AsyncIterable<ChromeTraceArrowSourceItem> {
      for (const batch of arrowBatches) {
        yield batch;
      }
    }

    const arrowSnapshot = await consumeChromeTraceArrowStream(arrowSession, batchSource(), {
      name: 'streamed-file',
      publishEveryEvents: 1
    });

    expect(arrowSnapshot?.traceGraphData.name).toBe(fileSnapshot?.traceGraphData.name);
    expect(arrowSnapshot?.traceGraph.processes.length).toBe(
      fileSnapshot?.traceGraph.processes.length
    );
    expect(
      arrowSnapshot?.traceGraph.getSpanRefByExternalBlockId('span:1:1:span-2:4:5' as TraceSpanId)
    ).toBeDefined();
    expect(
      fileSnapshot?.traceGraph.getSpanRefByExternalBlockId('span:1:1:span-2:4:5' as TraceSpanId)
    ).toBeDefined();
  });

  it('pipes Arrow record batches into streamChromeTraceArrowChunks', async () => {
    const traceFile = createChromeTraceFixture();
    const batchIterable = parseChromeTraceToArrowRecordBatches(
      streamChromeTraceFixture(traceFile),
      {
        batchSize: 2
      }
    );

    const chunks: TraceStreamChunk[] = [];
    for await (const chunk of streamChromeTraceArrowChunks(
      batchIterable as AsyncIterable<ChromeTraceArrowSourceItem>,
      {
        name: 'loader-batches',
        publishEveryEvents: 1
      }
    )) {
      chunks.push(chunk);
    }

    const finalChunk = chunks.at(-1);
    expect(finalChunk?.replaceSnapshot?.processes.map(process => process.name)).toContain('proc-1');
  });

  it('preserves async scope when consuming a public Arrow table stream', async () => {
    const traceFile = createChromeTraceFixture();
    const table = await parseChromeTraceArrowTable(traceFile);
    const session = createTraceStreamSession({publishIntervalMs: 0});

    async function* tableSource(): AsyncIterable<ChromeTraceArrowSourceItem> {
      yield table as ChromeTraceArrowSourceItem;
    }

    const snapshot = await consumeChromeTraceArrowStream(session, tableSource(), {
      name: 'public-arrow-table',
      publishEveryEvents: 1
    });

    expect(
      snapshot?.traceGraph.getSpanRefByExternalBlockId('span:1:1:span-2:4:5' as TraceSpanId)
    ).toBeDefined();
  });
});
