import * as arrow from 'apache-arrow';
import protobuf from 'protobufjs/dist/light/protobuf.js';

type ArrowTraceTable = 'tracks' | 'slices' | 'processes' | 'threads';

export interface ArrowTraceConsumer {
  onRecordBatch: (table: ArrowTraceTable, batch: arrow.RecordBatch) => void;
  onError: (err: Error) => void;
  onEnd: () => void;
}

export type TrackRow = {
  trackUuid: bigint;
  parentTrackUuid?: bigint;
  type: 'process' | 'thread' | 'slice' | 'counter' | 'async';
  name?: string;
  pid?: number;
  tid?: number;
};

export type SliceRow = {
  trackUuid: bigint;
  ts: bigint;
  dur: bigint;
  name: string;
};

export type ProcessRow = {
  pid: number;
  name?: string;
};

export type ThreadRow = {
  tid: number;
  pid?: number;
  name?: string;
};

const PERFETTO_MINIMAL_JSON = {
  nested: {
    perfetto: {
      nested: {
        protos: {
          nested: {
            ProcessDescriptor: {
              fields: {
                pid: {type: 'int32', id: 1},
                process_name: {type: 'string', id: 6}
              }
            },
            ThreadDescriptor: {
              fields: {
                pid: {type: 'int32', id: 1},
                tid: {type: 'int32', id: 2},
                thread_name: {type: 'string', id: 5}
              }
            },
            CounterDescriptor: {
              fields: {
                name: {type: 'string', id: 1}
              }
            },
            TrackDescriptor: {
              fields: {
                name: {type: 'string', id: 1},
                uuid: {type: 'uint64', id: 2},
                process: {type: 'ProcessDescriptor', id: 3},
                thread: {type: 'ThreadDescriptor', id: 4},
                parent_uuid: {type: 'uint64', id: 5},
                counter: {type: 'CounterDescriptor', id: 6}
              }
            },
            TrackEvent: {
              fields: {
                type: {type: 'Type', id: 1},
                timestamp: {type: 'uint64', id: 8},
                track_uuid: {type: 'uint64', id: 11},
                slice_name: {type: 'string', id: 23}
              },
              nested: {
                Type: {
                  values: {
                    TYPE_UNSPECIFIED: 0,
                    SLICE_BEGIN: 1,
                    SLICE_END: 2,
                    INSTANT: 3
                  }
                }
              }
            },
            TracePacket: {
              fields: {
                track_descriptor: {type: 'TrackDescriptor', id: 60},
                track_event: {type: 'TrackEvent', id: 11},
                process_descriptor: {type: 'ProcessDescriptor', id: 5},
                thread_descriptor: {type: 'ThreadDescriptor', id: 6}
              }
            }
          }
        }
      }
    }
  }
};

const perfettoRoot = protobuf.Root.fromJSON(PERFETTO_MINIMAL_JSON);
const TracePacket = perfettoRoot.lookupType('perfetto.protos.TracePacket');

export const TracksSchema = new arrow.Schema([
  new arrow.Field('track_uuid', new arrow.Uint64(), false),
  new arrow.Field('parent_track_uuid', new arrow.Uint64(), true),
  new arrow.Field('type', new arrow.Utf8(), false),
  new arrow.Field('name', new arrow.Utf8(), true),
  new arrow.Field('pid', new arrow.Int32(), true),
  new arrow.Field('tid', new arrow.Int32(), true)
]);

export const SlicesSchema = new arrow.Schema([
  new arrow.Field('track_uuid', new arrow.Uint64(), false),
  new arrow.Field('ts', new arrow.Uint64(), false),
  new arrow.Field('dur', new arrow.Uint64(), false),
  new arrow.Field('name', new arrow.Utf8(), false)
]);

export const ProcessesSchema = new arrow.Schema([
  new arrow.Field('pid', new arrow.Int32(), false),
  new arrow.Field('name', new arrow.Utf8(), true)
]);

export const ThreadsSchema = new arrow.Schema([
  new arrow.Field('tid', new arrow.Int32(), false),
  new arrow.Field('pid', new arrow.Int32(), true),
  new arrow.Field('name', new arrow.Utf8(), true)
]);

type OpenSlice = {
  ts: bigint;
  name: string;
};

class ParserState {
  tracks = new Map<bigint, TrackRow>();
  processes = new Set<number>();
  threads = new Set<number>();
  openSlices = new Map<bigint, OpenSlice[]>();
}

class TracksRowBuilder {
  rows: TrackRow[] = [];

  get length() {
    return this.rows.length;
  }

  append(row: TrackRow) {
    this.rows.push(row);
  }

  flush() {
    const table = arrow.tableFromJSON(
      this.rows.map(row => ({
        track_uuid: row.trackUuid,
        parent_track_uuid: row.parentTrackUuid ?? null,
        type: row.type,
        name: row.name ?? null,
        pid: row.pid ?? null,
        tid: row.tid ?? null
      }))
    );
    const [batch] = table.batches;
    this.reset();
    return batch;
  }

  reset() {
    this.rows = [];
  }
}

class SlicesRowBuilder {
  rows: SliceRow[] = [];

  get length() {
    return this.rows.length;
  }

  append(row: SliceRow) {
    this.rows.push(row);
  }

  flush() {
    const table = arrow.tableFromJSON(
      this.rows.map(row => ({
        track_uuid: row.trackUuid,
        ts: row.ts,
        dur: row.dur,
        name: row.name
      }))
    );
    const [batch] = table.batches;
    this.reset();
    return batch;
  }

  reset() {
    this.rows = [];
  }
}

class ProcessesRowBuilder {
  rows: ProcessRow[] = [];

  get length() {
    return this.rows.length;
  }

  append(row: ProcessRow) {
    this.rows.push(row);
  }

  flush() {
    const table = arrow.tableFromJSON(
      this.rows.map(row => ({
        pid: row.pid,
        name: row.name ?? null
      }))
    );
    const [batch] = table.batches;
    this.reset();
    return batch;
  }

  reset() {
    this.rows = [];
  }
}

class ThreadsRowBuilder {
  rows: ThreadRow[] = [];

  get length() {
    return this.rows.length;
  }

  append(row: ThreadRow) {
    this.rows.push(row);
  }

  flush() {
    const table = arrow.tableFromJSON(
      this.rows.map(row => ({
        tid: row.tid,
        pid: row.pid ?? null,
        name: row.name ?? null
      }))
    );
    const [batch] = table.batches;
    this.reset();
    return batch;
  }

  reset() {
    this.rows = [];
  }
}

function* decodeTracePacketStream(buffer: Uint8Array) {
  const reader = protobuf.Reader.create(buffer);
  while (reader.pos < reader.len) {
    yield TracePacket.decodeDelimited(reader) as protobuf.Message<object> & {
      trackDescriptor?: unknown;
      trackEvent?: unknown;
      processDescriptor?: unknown;
      threadDescriptor?: unknown;
    };
  }
}

function toBigInt(value?: number | string | protobuf.Long | bigint | null) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  if (typeof (value as protobuf.Long).toString === 'function') {
    return BigInt((value as protobuf.Long).toString());
  }
  return BigInt(value as unknown as number);
}

function inferTrackType(descriptor: {process?: unknown; thread?: unknown; counter?: unknown}) {
  if (descriptor.process) return 'process';
  if (descriptor.thread) return 'thread';
  if (descriptor.counter) return 'counter';
  return 'slice';
}

function normalizeTrackEventType(value: number | string | null | undefined) {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  switch (value) {
    case 1:
      return 'SLICE_BEGIN';
    case 2:
      return 'SLICE_END';
    case 3:
      return 'INSTANT';
    default:
      return undefined;
  }
}

function handleTrackDescriptor(
  descriptor: {
    uuid?: number | string | protobuf.Long | bigint | null;
    parentUuid?: number | string | protobuf.Long | bigint | null;
    name?: string;
    process?: {pid?: number | null} | null;
    thread?: {tid?: number | null} | null;
    counter?: unknown;
  },
  state: ParserState,
  trackRows: TracksRowBuilder,
  consumer: ArrowTraceConsumer,
  batchSize: number
) {
  const uuid = toBigInt(descriptor.uuid ?? (descriptor as {uuid?: number}).uuid);
  if (!uuid) return;
  if (state.tracks.has(uuid)) return;

  const row: TrackRow = {
    trackUuid: uuid,
    parentTrackUuid:
      toBigInt(descriptor.parentUuid ?? (descriptor as {parent_uuid?: number}).parent_uuid) ??
      undefined,
    type: inferTrackType(descriptor),
    name: descriptor.name ?? undefined,
    pid: descriptor.process?.pid ?? undefined,
    tid: descriptor.thread?.tid ?? undefined
  };

  state.tracks.set(uuid, row);
  trackRows.append(row);

  if (trackRows.length >= batchSize) {
    consumer.onRecordBatch('tracks', trackRows.flush());
  }
}

function handleProcessDescriptor(
  descriptor: {pid?: number | null; processName?: string | null},
  state: ParserState,
  processRows: ProcessesRowBuilder,
  consumer: ArrowTraceConsumer,
  batchSize: number
) {
  const pid = descriptor.pid;
  if (pid === null || pid === undefined) return;
  if (state.processes.has(pid)) return;
  state.processes.add(pid);

  processRows.append({
    pid,
    name:
      descriptor.processName ??
      (descriptor as {process_name?: string | null}).process_name ??
      undefined
  });
  if (processRows.length >= batchSize) {
    consumer.onRecordBatch('processes', processRows.flush());
  }
}

function handleThreadDescriptor(
  descriptor: {tid?: number | null; pid?: number | null; threadName?: string | null},
  state: ParserState,
  threadRows: ThreadsRowBuilder,
  consumer: ArrowTraceConsumer,
  batchSize: number
) {
  const tid = descriptor.tid;
  if (tid === null || tid === undefined) return;
  if (state.threads.has(tid)) return;
  state.threads.add(tid);

  threadRows.append({
    tid,
    pid: descriptor.pid ?? undefined,
    name:
      descriptor.threadName ??
      (descriptor as {thread_name?: string | null}).thread_name ??
      undefined
  });
  if (threadRows.length >= batchSize) {
    consumer.onRecordBatch('threads', threadRows.flush());
  }
}

function handleTrackEvent(
  event: {
    type?: number | string | null;
    trackUuid?: number | string | protobuf.Long | bigint | null;
    timestamp?: number | string | protobuf.Long | bigint | null;
    sliceName?: string | null;
  },
  state: ParserState,
  sliceRows: SlicesRowBuilder,
  consumer: ArrowTraceConsumer,
  batchSize: number
) {
  const trackUuid = toBigInt(event.trackUuid ?? (event as {track_uuid?: number}).track_uuid);
  if (!trackUuid) return;
  const ts = toBigInt(event.timestamp ?? (event as {timestamp?: number}).timestamp);
  if (ts === null) return;

  const type = normalizeTrackEventType(event.type);
  const stack = state.openSlices.get(trackUuid) ?? [];
  const name = event.sliceName ?? (event as {slice_name?: string | null}).slice_name ?? 'slice';

  if (type === 'SLICE_BEGIN') {
    stack.push({ts, name});
    state.openSlices.set(trackUuid, stack);
    return;
  }

  if (type === 'SLICE_END') {
    const begin = stack.pop();
    if (!begin) return;
    sliceRows.append({
      trackUuid,
      ts: begin.ts,
      dur: ts - begin.ts,
      name: begin.name
    });
  }

  if (type === 'INSTANT') {
    sliceRows.append({
      trackUuid,
      ts,
      dur: 0n,
      name
    });
  }

  if (sliceRows.length >= batchSize) {
    consumer.onRecordBatch('slices', sliceRows.flush());
  }
}

export async function parsePerfettoTraceToArrow(
  buffer: Uint8Array,
  consumer: ArrowTraceConsumer,
  batchSize = 4096
) {
  const state = new ParserState();
  const trackRows = new TracksRowBuilder();
  const sliceRows = new SlicesRowBuilder();
  const processRows = new ProcessesRowBuilder();
  const threadRows = new ThreadsRowBuilder();

  try {
    for (const packet of decodeTracePacketStream(buffer)) {
      const typedPacket = packet as {
        trackDescriptor?: {
          uuid?: number | string | protobuf.Long | bigint | null;
          parentUuid?: number | string | protobuf.Long | bigint | null;
          name?: string;
          process?: {pid?: number | null} | null;
          thread?: {tid?: number | null} | null;
          counter?: unknown;
        } | null;
        trackEvent?: {
          type?: number | string | null;
          trackUuid?: number | string | protobuf.Long | bigint | null;
          timestamp?: number | string | protobuf.Long | bigint | null;
          sliceName?: string | null;
        } | null;
        processDescriptor?: {pid?: number | null; processName?: string | null} | null;
        threadDescriptor?: {
          tid?: number | null;
          pid?: number | null;
          threadName?: string | null;
        } | null;
      };
      const trackDescriptor =
        typedPacket.trackDescriptor ??
        (packet as {track_descriptor?: typeof typedPacket.trackDescriptor}).track_descriptor;
      const trackEvent =
        typedPacket.trackEvent ??
        (packet as {track_event?: typeof typedPacket.trackEvent}).track_event;
      const processDescriptor =
        typedPacket.processDescriptor ??
        (packet as {process_descriptor?: typeof typedPacket.processDescriptor}).process_descriptor;
      const threadDescriptor =
        typedPacket.threadDescriptor ??
        (packet as {thread_descriptor?: typeof typedPacket.threadDescriptor}).thread_descriptor;

      if (trackDescriptor) {
        handleTrackDescriptor(trackDescriptor, state, trackRows, consumer, batchSize);
      }

      if (processDescriptor) {
        handleProcessDescriptor(processDescriptor, state, processRows, consumer, batchSize);
      }

      if (threadDescriptor) {
        handleThreadDescriptor(threadDescriptor, state, threadRows, consumer, batchSize);
      }

      if (trackEvent) {
        handleTrackEvent(trackEvent, state, sliceRows, consumer, batchSize);
      }
    }

    if (trackRows.length) {
      consumer.onRecordBatch('tracks', trackRows.flush());
    }
    if (processRows.length) {
      consumer.onRecordBatch('processes', processRows.flush());
    }
    if (threadRows.length) {
      consumer.onRecordBatch('threads', threadRows.flush());
    }
    if (sliceRows.length) {
      consumer.onRecordBatch('slices', sliceRows.flush());
    }

    consumer.onEnd();
  } catch (error) {
    consumer.onError(error as Error);
  }
}
