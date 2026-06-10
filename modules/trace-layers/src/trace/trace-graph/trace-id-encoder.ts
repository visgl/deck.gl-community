import {brand} from './trace-types';

import type {LocalSpanRef, SpanRef, TraceProcessId} from './trace-types';

type BrandedEntityRef<Label extends string> = number & {readonly __brand: Label};
type BrandedDependencyRef<Label extends string> = number & {readonly __brand: Label};

/** Branded runtime reference for one canonical process row. */
export type ProcessRef = BrandedEntityRef<'process-ref'>;
/** Branded runtime reference for one canonical thread row. */
export type ThreadRef = BrandedEntityRef<'thread-ref'>;
/** Branded runtime reference for one canonical graph-global event row. */
export type EventRef = BrandedEntityRef<'event-ref'>;
/** Branded runtime reference for one canonical instant row. */
export type InstantRef = BrandedEntityRef<'instant-ref'>;
/** Branded runtime reference for one canonical counter row. */
export type CounterRef = BrandedEntityRef<'counter-ref'>;
/** Branded runtime reference for one loaded storage chunk. */
export type ChunkRef = BrandedEntityRef<'chunk-ref'>;
/** Branded directional reference for compact local dependency refs. */
export type LocalDependencyRef = BrandedDependencyRef<'local-dependency-ref'>;
/** Branded directional reference for compact cross dependency refs. */
export type CrossDependencyRef = BrandedDependencyRef<'cross-dependency-ref'>;
/** Branded reference for a filtered stitched parent dependency row. */
export type StitchedParentDependencyRef = BrandedDependencyRef<'stitched-parent-dependency-ref'>;
/** Branded reference for compact visible local dependency refs. */
export type VisibleLocalDependencyRef = BrandedDependencyRef<'visible-local-dependency-ref'>;
/** Branded reference for compact visible cross dependency refs. */
export type VisibleCrossDependencyRef = BrandedDependencyRef<'visible-cross-dependency-ref'>;
/** Branded directional reference for any visible dependency ref. */
export type VisibleDependencyRef = VisibleLocalDependencyRef | VisibleCrossDependencyRef;
/** Branded directional reference for compact local or cross dependency refs. */
export type DependencyRef = LocalDependencyRef | CrossDependencyRef;
/** Canonical runtime dependency ref used by render, selection, and card paths. */
export type TraceDependencyRef =
  | LocalDependencyRef
  | CrossDependencyRef
  | StitchedParentDependencyRef;
/** Branded directional reference for any dependency kind in a compact form. */
export type GlobalDependencyRef = DependencyRef;
/** Branded runtime reference for any compact non-span entity in a graph-local form. */
export type TraceEntityRef = ProcessRef | ThreadRef | EventRef | InstantRef | CounterRef;

const SPAN_REF_ROW_FACTOR = 0x1_0000_0000;
const LOCAL_DEPENDENCY_ROW_FACTOR = 0x1_0000_0000;
const THREAD_INDEX_FACTOR = 0x1000_0000;
const CHUNK_ROW_REF_FACTOR = 0x200_0000;
const CHUNK_REF_PAYLOAD_FACTOR = 0x1_0000_0000;
const SAFE_INTEGER_REF_SPACE = Math.pow(2, 53);
const PREFIX_REF_PAYLOAD_BITS_BY_KIND = {
  span: 52,
  localDependency: 51,
  event: 50,
  crossDependency: 49,
  thread: 48,
  process: 47,
  instant: 45,
  counter: 45,
  visibleLocalDependency: 45,
  visibleCrossDependency: 45
} as const;
const PREFIX_REF_PAYLOAD_FACTOR_BY_KIND = {
  span: Math.pow(2, PREFIX_REF_PAYLOAD_BITS_BY_KIND.span),
  localDependency: Math.pow(2, PREFIX_REF_PAYLOAD_BITS_BY_KIND.localDependency),
  event: Math.pow(2, PREFIX_REF_PAYLOAD_BITS_BY_KIND.event),
  crossDependency: Math.pow(2, PREFIX_REF_PAYLOAD_BITS_BY_KIND.crossDependency),
  thread: Math.pow(2, PREFIX_REF_PAYLOAD_BITS_BY_KIND.thread),
  process: Math.pow(2, PREFIX_REF_PAYLOAD_BITS_BY_KIND.process),
  instant: Math.pow(2, PREFIX_REF_PAYLOAD_BITS_BY_KIND.instant),
  counter: Math.pow(2, PREFIX_REF_PAYLOAD_BITS_BY_KIND.counter),
  visibleLocalDependency: Math.pow(2, PREFIX_REF_PAYLOAD_BITS_BY_KIND.visibleLocalDependency),
  visibleCrossDependency: Math.pow(2, PREFIX_REF_PAYLOAD_BITS_BY_KIND.visibleCrossDependency)
} as const;
/**
 * Maximum chunk index that can be packed into one safe-integer {@link SpanRef}.
 */
export const MAX_SPAN_REF_CHUNK_INDEX = 0x0f_ffff;
/**
 * Maximum chunk-local row index that can be packed into one safe-integer {@link SpanRef}.
 */
export const MAX_SPAN_REF_ROW_INDEX = 0xffff_ffff;
/** Numeric tag offset for compact local dependency refs. */
export const LOCAL_DEPENDENCY_REF_OFFSET = PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.span;
/** Numeric tag offset for compact cross-process dependency refs. */
export const CROSS_DEPENDENCY_REF_OFFSET =
  LOCAL_DEPENDENCY_REF_OFFSET +
  PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.localDependency +
  PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.event;
/** Numeric tag offset for visible local dependency refs. */
export const VISIBLE_LOCAL_DEPENDENCY_REF_OFFSET =
  SAFE_INTEGER_REF_SPACE - PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.visibleLocalDependency * 2;
/** Numeric tag offset for visible cross-process dependency refs. */
export const VISIBLE_CROSS_DEPENDENCY_REF_OFFSET =
  SAFE_INTEGER_REF_SPACE - PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.visibleCrossDependency;
/** Numeric tag offset for compact graph-global event refs. */
export const EVENT_REF_OFFSET =
  LOCAL_DEPENDENCY_REF_OFFSET + PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.localDependency;
/** Numeric tag offset for compact instant refs. */
export const INSTANT_REF_OFFSET =
  SAFE_INTEGER_REF_SPACE - PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.instant * 4;
/** Numeric tag offset for compact counter refs. */
export const COUNTER_REF_OFFSET =
  SAFE_INTEGER_REF_SPACE - PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.counter * 3;
/** Numeric tag offset for compact thread refs. */
export const THREAD_REF_OFFSET =
  CROSS_DEPENDENCY_REF_OFFSET + PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.crossDependency;
/** Numeric tag offset for compact process refs. */
export const PROCESS_REF_OFFSET = THREAD_REF_OFFSET + PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.thread;
/** Numeric tag offset for loaded storage chunk refs. */
export const CHUNK_REF_OFFSET = INSTANT_REF_OFFSET - CHUNK_REF_PAYLOAD_FACTOR;
/** Maximum packed span ref that remains safely representable in JavaScript numbers. */
export const MAX_SPAN_REF = SPAN_REF_ROW_FACTOR * (MAX_SPAN_REF_CHUNK_INDEX + 1) - 1;
/** Maximum cross-process dependency index that can be packed into a tagged ref. */
export const MAX_CROSS_DEPENDENCY_INDEX = PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.crossDependency - 1;
/** Maximum visible dependency index that can be packed into a tagged visible ref. */
export const MAX_VISIBLE_DEPENDENCY_INDEX =
  PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.visibleLocalDependency - 1;
/** Maximum event index that can be packed into a tagged event ref. */
export const MAX_EVENT_REF_INDEX = PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.event - 1;
/** Maximum instant index that can be packed into a tagged instant ref. */
export const MAX_INSTANT_REF_INDEX = PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.instant - 1;
/** Maximum counter index that can be packed into a tagged counter ref. */
export const MAX_COUNTER_REF_INDEX = PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.counter - 1;
/** Maximum thread index that can be packed into a tagged thread ref. */
export const MAX_THREAD_REF_INDEX = PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.thread - 1;
/** Maximum process index that can be packed into a tagged process ref. */
export const MAX_PROCESS_REF_INDEX = CHUNK_REF_OFFSET - PROCESS_REF_OFFSET - 1;
/** Maximum chunk index that can be packed into a tagged chunk ref. */
export const MAX_CHUNK_REF_INDEX = CHUNK_REF_PAYLOAD_FACTOR - 1;
/** Maximum chunk-local row index that can be packed into chunk-row entity refs. */
export const MAX_CHUNK_ROW_ENTITY_REF_ROW_INDEX = CHUNK_ROW_REF_FACTOR - 1;
/** Maximum event chunk index that can be packed into a tagged event ref. */
export const MAX_EVENT_REF_CHUNK_INDEX = Math.floor(MAX_EVENT_REF_INDEX / CHUNK_ROW_REF_FACTOR);
/** Maximum instant chunk index that can be packed into a tagged instant ref. */
export const MAX_INSTANT_REF_CHUNK_INDEX = Math.floor(MAX_INSTANT_REF_INDEX / CHUNK_ROW_REF_FACTOR);
/** Maximum counter chunk index that can be packed into a tagged counter ref. */
export const MAX_COUNTER_REF_CHUNK_INDEX = Math.floor(MAX_COUNTER_REF_INDEX / CHUNK_ROW_REF_FACTOR);
/** Maximum process index that can be packed with a 32-bit local dependency row index. */
export const MAX_LOCAL_DEPENDENCY_REF_PROCESS_INDEX = Math.floor(
  (PREFIX_REF_PAYLOAD_FACTOR_BY_KIND.localDependency - 1) / LOCAL_DEPENDENCY_ROW_FACTOR
);
/** Maximum process-local thread index that can be packed into a process-aware thread ref. */
export const MAX_PROCESS_LOCAL_THREAD_REF_INDEX = THREAD_INDEX_FACTOR - 1;

/** Runtime ref families recognized by the shared numeric prefix decoder. */
export type TraceRefKind =
  | 'span'
  | 'localDependency'
  | 'event'
  | 'crossDependency'
  | 'thread'
  | 'process'
  | 'chunk'
  | 'instant'
  | 'counter'
  | 'visibleLocalDependency'
  | 'visibleCrossDependency';

/** Decoded storage address for one numeric runtime ref. */
export type DecodedTraceRef =
  | {
      /** Ref family encoded in the high-order numeric prefix. */
      readonly kind: 'span';
      /** Original branded span ref. */
      readonly ref: SpanRef;
      /** Chunk index encoded in the payload. */
      readonly chunkIndex: number;
      /** Process-local or chunk-local row index encoded in the payload. */
      readonly rowIndex: number;
    }
  | {
      /** Ref family encoded in the high-order numeric prefix. */
      readonly kind: 'localDependency';
      /** Original branded local dependency ref. */
      readonly ref: LocalDependencyRef;
      /** Process index encoded in the payload. */
      readonly processIndex: number;
      /** Process index encoded in the payload. Retained for compatibility. */
      readonly chunkIndex: number;
      /** Process-local dependency row index encoded in the payload. */
      readonly rowIndex: number;
    }
  | {
      /** Ref family encoded in the high-order numeric prefix. */
      readonly kind: 'event';
      /** Original branded event ref. */
      readonly ref: EventRef;
      /** Chunk index encoded in the payload. */
      readonly chunkIndex: number;
      /** Chunk-local event row index encoded in the payload. */
      readonly rowIndex: number;
    }
  | {
      /** Ref family encoded in the high-order numeric prefix. */
      readonly kind: 'crossDependency';
      /** Original branded cross dependency ref. */
      readonly ref: CrossDependencyRef;
      /** Chunk index encoded in the payload. */
      readonly chunkIndex: number;
      /** Chunk-local cross dependency row index encoded in the payload. */
      readonly rowIndex: number;
    }
  | {
      /** Ref family encoded in the high-order numeric prefix. */
      readonly kind: 'thread';
      /** Original branded thread ref. */
      readonly ref: ThreadRef;
      /** Owning process index encoded in the payload. */
      readonly processIndex: number;
      /** Process-local thread index encoded in the payload. */
      readonly threadIndex: number;
      /** Raw tagged payload. */
      readonly index: number;
    }
  | {
      /** Ref family encoded in the high-order numeric prefix. */
      readonly kind: 'process';
      /** Original branded process ref. */
      readonly ref: ProcessRef;
      /** Stable graph-local process index encoded in the payload. */
      readonly processIndex: number;
      /** Raw tagged payload. */
      readonly index: number;
    }
  | {
      /** Ref family encoded in the high-order numeric prefix. */
      readonly kind: 'chunk';
      /** Original branded chunk ref. */
      readonly ref: ChunkRef;
      /** Loaded storage chunk index encoded in the payload. */
      readonly chunkIndex: number;
      /** Raw tagged payload. */
      readonly index: number;
    }
  | {
      /** Ref family encoded in the high-order numeric prefix. */
      readonly kind: 'instant';
      /** Original branded instant ref. */
      readonly ref: InstantRef;
      /** Chunk index encoded in the payload. */
      readonly chunkIndex: number;
      /** Chunk-local instant row index encoded in the payload. */
      readonly rowIndex: number;
    }
  | {
      /** Ref family encoded in the high-order numeric prefix. */
      readonly kind: 'counter';
      /** Original branded counter ref. */
      readonly ref: CounterRef;
      /** Chunk index encoded in the payload. */
      readonly chunkIndex: number;
      /** Chunk-local counter row index encoded in the payload. */
      readonly rowIndex: number;
    }
  | {
      /** Ref family encoded in the high-order numeric prefix. */
      readonly kind: 'visibleLocalDependency';
      /** Original branded visible local dependency ref. */
      readonly ref: VisibleLocalDependencyRef;
      /** Visible-index row encoded in the payload. */
      readonly index: number;
    }
  | {
      /** Ref family encoded in the high-order numeric prefix. */
      readonly kind: 'visibleCrossDependency';
      /** Original branded visible cross dependency ref. */
      readonly ref: VisibleCrossDependencyRef;
      /** Visible-index row encoded in the payload. */
      readonly index: number;
    };

/** Mutable decode target for allocation-free generic runtime ref decoding. */
export type TraceRefDecodeScratch = {
  /** Decoded ref family, or null when the last decode failed. */
  kind: TraceRefKind | null;
  /** Original numeric ref, or -1 when the last decode failed. */
  ref: number;
  /** Decoded chunk index for chunk-row refs, or local process index for local refs. */
  chunkIndex: number;
  /** Decoded row index for chunk-row and process-local refs, or -1 when not applicable. */
  rowIndex: number;
  /** Decoded process index for process, thread, and local dependency refs. */
  processIndex: number;
  /** Decoded process-local thread index for thread refs, or -1 when not applicable. */
  threadIndex: number;
  /** Decoded raw payload/index for single-index refs, or -1 when not applicable. */
  index: number;
};

/** Returns the high-order numeric prefix family for one runtime ref. */
export function getTraceRefKind(value: number): TraceRefKind | null {
  if (!isValidRuntimeRefValue(value)) {
    return null;
  }
  if (value < LOCAL_DEPENDENCY_REF_OFFSET) {
    return 'span';
  }
  if (value < EVENT_REF_OFFSET) {
    return 'localDependency';
  }
  if (value < CROSS_DEPENDENCY_REF_OFFSET) {
    return 'event';
  }
  if (value < THREAD_REF_OFFSET) {
    return 'crossDependency';
  }
  if (value < PROCESS_REF_OFFSET) {
    return 'thread';
  }
  if (value < CHUNK_REF_OFFSET) {
    return 'process';
  }
  if (value < INSTANT_REF_OFFSET) {
    return 'chunk';
  }
  if (value < COUNTER_REF_OFFSET) {
    return 'instant';
  }
  if (value < VISIBLE_LOCAL_DEPENDENCY_REF_OFFSET) {
    return 'counter';
  }
  if (value < VISIBLE_CROSS_DEPENDENCY_REF_OFFSET) {
    return 'visibleLocalDependency';
  }
  return 'visibleCrossDependency';
}

/** Decodes one numeric runtime ref into the provided mutable scratch object. */
export function decodeTraceRefInto(value: number, scratch: TraceRefDecodeScratch): boolean {
  const kind = getTraceRefKind(value);
  if (kind == null) {
    scratch.kind = null;
    scratch.ref = -1;
    scratch.chunkIndex = -1;
    scratch.rowIndex = -1;
    scratch.processIndex = -1;
    scratch.threadIndex = -1;
    scratch.index = -1;
    return false;
  }

  scratch.kind = kind;
  scratch.ref = value;
  scratch.chunkIndex = -1;
  scratch.rowIndex = -1;
  scratch.processIndex = -1;
  scratch.threadIndex = -1;
  scratch.index = -1;

  switch (kind) {
    case 'span':
      scratch.chunkIndex = getSpanRefChunkIndex(value as SpanRef);
      scratch.rowIndex = getSpanRefRowIndex(value as SpanRef);
      break;
    case 'localDependency':
      scratch.processIndex = getLocalDependencyRefProcessIndex(value as LocalDependencyRef);
      scratch.chunkIndex = scratch.processIndex;
      scratch.rowIndex = getLocalDependencyRefRowIndex(value as LocalDependencyRef);
      break;
    case 'event':
      scratch.chunkIndex = getEventRefChunkIndex(value as EventRef);
      scratch.rowIndex = getEventRefRowIndex(value as EventRef);
      scratch.index = getEventRefIndex(value as EventRef);
      break;
    case 'crossDependency':
      scratch.chunkIndex = getCrossDependencyRefChunkIndex(value as CrossDependencyRef);
      scratch.rowIndex = getCrossDependencyRefRowIndex(value as CrossDependencyRef);
      scratch.index = getCrossDependencyRefIndex(value as CrossDependencyRef);
      break;
    case 'thread':
      scratch.processIndex = getThreadRefProcessIndex(value as ThreadRef);
      scratch.threadIndex = getThreadRefThreadIndex(value as ThreadRef);
      scratch.index = getThreadRefPayload(value as ThreadRef);
      break;
    case 'process':
      scratch.processIndex = getProcessRefIndex(value as ProcessRef);
      scratch.index = scratch.processIndex;
      break;
    case 'chunk':
      scratch.chunkIndex = getChunkRefIndex(value as ChunkRef);
      scratch.index = scratch.chunkIndex;
      break;
    case 'instant':
      scratch.chunkIndex = getInstantRefChunkIndex(value as InstantRef);
      scratch.rowIndex = getInstantRefRowIndex(value as InstantRef);
      scratch.index = getInstantRefIndex(value as InstantRef);
      break;
    case 'counter':
      scratch.chunkIndex = getCounterRefChunkIndex(value as CounterRef);
      scratch.rowIndex = getCounterRefRowIndex(value as CounterRef);
      scratch.index = getCounterRefIndex(value as CounterRef);
      break;
    case 'visibleLocalDependency':
      scratch.index = getVisibleLocalDependencyRefIndex(value as VisibleLocalDependencyRef);
      break;
    case 'visibleCrossDependency':
      scratch.index = getVisibleCrossDependencyRefIndex(value as VisibleCrossDependencyRef);
      break;
  }

  return true;
}

/**
 * Decodes one numeric runtime ref into its tagged storage-address payload.
 *
 * This object-returning helper is intended for compatibility, diagnostics, and
 * low-frequency generic code. Hot runtime paths should use direct accessors or
 * {@link decodeTraceRefInto}.
 */
export function decodeTraceRef(value: number): DecodedTraceRef | null {
  const kind = getTraceRefKind(value);
  if (kind == null) {
    return null;
  }

  switch (kind) {
    case 'span':
      return {
        kind,
        ref: value as SpanRef,
        chunkIndex: getSpanRefChunkIndex(value as SpanRef),
        rowIndex: getSpanRefRowIndex(value as SpanRef)
      };
    case 'localDependency': {
      const processIndex = getLocalDependencyRefProcessIndex(value as LocalDependencyRef);
      return {
        kind,
        ref: value as LocalDependencyRef,
        processIndex,
        chunkIndex: processIndex,
        rowIndex: getLocalDependencyRefRowIndex(value as LocalDependencyRef)
      };
    }
    case 'event':
      return {
        kind,
        ref: value as EventRef,
        chunkIndex: getEventRefChunkIndex(value as EventRef),
        rowIndex: getEventRefRowIndex(value as EventRef)
      };
    case 'crossDependency':
      return {
        kind,
        ref: value as CrossDependencyRef,
        chunkIndex: getCrossDependencyRefChunkIndex(value as CrossDependencyRef),
        rowIndex: getCrossDependencyRefRowIndex(value as CrossDependencyRef)
      };
    case 'thread':
      return {
        kind,
        ref: value as ThreadRef,
        processIndex: getThreadRefProcessIndex(value as ThreadRef),
        threadIndex: getThreadRefThreadIndex(value as ThreadRef),
        index: getThreadRefPayload(value as ThreadRef)
      };
    case 'process':
      return {
        kind,
        ref: value as ProcessRef,
        processIndex: getProcessRefIndex(value as ProcessRef),
        index: getProcessRefIndex(value as ProcessRef)
      };
    case 'chunk':
      return {
        kind,
        ref: value as ChunkRef,
        chunkIndex: getChunkRefIndex(value as ChunkRef),
        index: getChunkRefIndex(value as ChunkRef)
      };
    case 'instant':
      return {
        kind,
        ref: value as InstantRef,
        chunkIndex: getInstantRefChunkIndex(value as InstantRef),
        rowIndex: getInstantRefRowIndex(value as InstantRef)
      };
    case 'counter':
      return {
        kind,
        ref: value as CounterRef,
        chunkIndex: getCounterRefChunkIndex(value as CounterRef),
        rowIndex: getCounterRefRowIndex(value as CounterRef)
      };
    case 'visibleLocalDependency':
      return {
        kind,
        ref: value as VisibleLocalDependencyRef,
        index: getVisibleLocalDependencyRefIndex(value as VisibleLocalDependencyRef)
      };
    case 'visibleCrossDependency':
      return {
        kind,
        ref: value as VisibleCrossDependencyRef,
        index: getVisibleCrossDependencyRefIndex(value as VisibleCrossDependencyRef)
      };
  }
}

/** Marks one encoded runtime reference as a compact process reference. */
export function isProcessRef(value: number): value is ProcessRef {
  return isEntityRefInRange(value, PROCESS_REF_OFFSET, MAX_PROCESS_REF_INDEX);
}

/** Marks one encoded runtime reference as a compact thread reference. */
export function isThreadRef(value: number): value is ThreadRef {
  return isEntityRefInRange(value, THREAD_REF_OFFSET, MAX_THREAD_REF_INDEX);
}

/** Marks one encoded runtime reference as a compact graph-global event reference. */
export function isEventRef(value: number): value is EventRef {
  return isEntityRefInRange(value, EVENT_REF_OFFSET, MAX_EVENT_REF_INDEX);
}

/** Marks one encoded runtime reference as a compact instant reference. */
export function isInstantRef(value: number): value is InstantRef {
  return isEntityRefInRange(value, INSTANT_REF_OFFSET, MAX_INSTANT_REF_INDEX);
}

/** Marks one encoded runtime reference as a compact counter reference. */
export function isCounterRef(value: number): value is CounterRef {
  return isEntityRefInRange(value, COUNTER_REF_OFFSET, MAX_COUNTER_REF_INDEX);
}

/** Marks one encoded runtime reference as a loaded storage chunk reference. */
export function isChunkRef(value: number): value is ChunkRef {
  return isEntityRefInRange(value, CHUNK_REF_OFFSET, MAX_CHUNK_REF_INDEX);
}

/** Marks one encoded runtime reference as a packed span reference. */
export function isSpanRef(value: number): value is SpanRef {
  return Number.isSafeInteger(value) && value >= 0 && value < LOCAL_DEPENDENCY_REF_OFFSET;
}

/** Returns the stable graph-local process index encoded in one process ref. */
export function getProcessRefIndex(ref: ProcessRef): number {
  return ref - PROCESS_REF_OFFSET;
}

/** Returns the loaded storage chunk index encoded in one chunk ref. */
export function getChunkRefIndex(ref: ChunkRef): number {
  return ref - CHUNK_REF_OFFSET;
}

/** Returns the raw process/thread payload encoded in one thread ref. */
export function getThreadRefPayload(ref: ThreadRef): number {
  return ref - THREAD_REF_OFFSET;
}

/** Returns the owning process index encoded in one thread ref. */
export function getThreadRefProcessIndex(ref: ThreadRef): number {
  return Math.floor(getThreadRefPayload(ref) / THREAD_INDEX_FACTOR);
}

/** Returns the process-local thread index encoded in one thread ref. */
export function getThreadRefThreadIndex(ref: ThreadRef): number {
  return getThreadRefPayload(ref) % THREAD_INDEX_FACTOR;
}

/** Returns the packed local dependency payload encoded in one local dependency ref. */
export function getLocalDependencyRefPayload(ref: LocalDependencyRef): number {
  return ref - LOCAL_DEPENDENCY_REF_OFFSET;
}

/** Returns the process index encoded in one local dependency ref. */
export function getLocalDependencyRefProcessIndex(ref: LocalDependencyRef): number {
  return Math.floor(getLocalDependencyRefPayload(ref) / LOCAL_DEPENDENCY_ROW_FACTOR);
}

/** Returns the process-local row index encoded in one local dependency ref. */
export function getLocalDependencyRefRowIndex(ref: LocalDependencyRef): number {
  return getLocalDependencyRefPayload(ref) % LOCAL_DEPENDENCY_ROW_FACTOR;
}

/** Returns the raw event payload encoded in one event ref. */
export function getEventRefIndex(ref: EventRef): number {
  return ref - EVENT_REF_OFFSET;
}

/** Returns the loaded chunk index encoded in one event ref. */
export function getEventRefChunkIndex(ref: EventRef): number {
  return Math.floor(getEventRefIndex(ref) / CHUNK_ROW_REF_FACTOR);
}

/** Returns the chunk-local row index encoded in one event ref. */
export function getEventRefRowIndex(ref: EventRef): number {
  return getEventRefIndex(ref) % CHUNK_ROW_REF_FACTOR;
}

/** Returns the raw cross dependency payload encoded in one cross dependency ref. */
export function getCrossDependencyRefIndex(ref: CrossDependencyRef): number {
  return ref - CROSS_DEPENDENCY_REF_OFFSET;
}

/** Returns the loaded chunk index encoded in one cross dependency ref. */
export function getCrossDependencyRefChunkIndex(ref: CrossDependencyRef): number {
  return Math.floor(getCrossDependencyRefIndex(ref) / CHUNK_ROW_REF_FACTOR);
}

/** Returns the chunk-local row index encoded in one cross dependency ref. */
export function getCrossDependencyRefRowIndex(ref: CrossDependencyRef): number {
  return getCrossDependencyRefIndex(ref) % CHUNK_ROW_REF_FACTOR;
}

/** Returns the raw instant payload encoded in one instant ref. */
export function getInstantRefIndex(ref: InstantRef): number {
  return ref - INSTANT_REF_OFFSET;
}

/** Returns the loaded chunk index encoded in one instant ref. */
export function getInstantRefChunkIndex(ref: InstantRef): number {
  return Math.floor(getInstantRefIndex(ref) / CHUNK_ROW_REF_FACTOR);
}

/** Returns the chunk-local row index encoded in one instant ref. */
export function getInstantRefRowIndex(ref: InstantRef): number {
  return getInstantRefIndex(ref) % CHUNK_ROW_REF_FACTOR;
}

/** Returns the raw counter payload encoded in one counter ref. */
export function getCounterRefIndex(ref: CounterRef): number {
  return ref - COUNTER_REF_OFFSET;
}

/** Returns the loaded chunk index encoded in one counter ref. */
export function getCounterRefChunkIndex(ref: CounterRef): number {
  return Math.floor(getCounterRefIndex(ref) / CHUNK_ROW_REF_FACTOR);
}

/** Returns the chunk-local row index encoded in one counter ref. */
export function getCounterRefRowIndex(ref: CounterRef): number {
  return getCounterRefIndex(ref) % CHUNK_ROW_REF_FACTOR;
}

/** Returns the visible dependency row index encoded in one visible local dependency ref. */
export function getVisibleLocalDependencyRefIndex(ref: VisibleLocalDependencyRef): number {
  return ref - VISIBLE_LOCAL_DEPENDENCY_REF_OFFSET;
}

/** Returns the visible dependency row index encoded in one visible cross dependency ref. */
export function getVisibleCrossDependencyRefIndex(ref: VisibleCrossDependencyRef): number {
  return ref - VISIBLE_CROSS_DEPENDENCY_REF_OFFSET;
}

/** Decodes one process ref into its stable graph-local process index. */
export function decodeProcessRef(value: number): number | null {
  return isProcessRef(value) ? getProcessRefIndex(value) : null;
}

/** Decodes one thread ref into its stable graph-local thread index. */
export function decodeThreadRef(value: number): number | null {
  return isThreadRef(value) ? getThreadRefPayload(value) : null;
}

/** Decodes one event ref into its stable graph-local event index. */
export function decodeEventRef(value: number): number | null {
  return isEventRef(value) ? getEventRefIndex(value) : null;
}

/** Decodes one instant ref into its stable graph-local instant index. */
export function decodeInstantRef(value: number): number | null {
  return isInstantRef(value) ? getInstantRefIndex(value) : null;
}

/** Decodes one counter ref into its stable graph-local counter index. */
export function decodeCounterRef(value: number): number | null {
  return isCounterRef(value) ? getCounterRefIndex(value) : null;
}

/** Decodes one chunk ref into its loaded storage chunk index. */
export function decodeChunkRef(value: number): number | null {
  return isChunkRef(value) ? getChunkRefIndex(value) : null;
}

/** Encodes one stable process index into a compact process ref. */
export function encodeProcessRef(index: number): ProcessRef {
  return encodeEntityRef('process', PROCESS_REF_OFFSET, MAX_PROCESS_REF_INDEX, index);
}

/** Encodes one stable thread index into a compact thread ref. */
export function encodeThreadRef(index: number): ThreadRef {
  return encodeEntityRef('thread', THREAD_REF_OFFSET, MAX_THREAD_REF_INDEX, index);
}

/** Encodes one process-local thread index into a process-aware compact thread ref. */
export function encodeProcessThreadRef(processIndex: number, threadIndex: number): ThreadRef {
  assertRefComponent('thread processIndex', processIndex, MAX_SPAN_REF_CHUNK_INDEX);
  assertRefComponent('threadIndex', threadIndex, MAX_PROCESS_LOCAL_THREAD_REF_INDEX);
  return encodeThreadRef(processIndex * THREAD_INDEX_FACTOR + threadIndex);
}

/** Encodes one stable event index into a compact event ref. */
export function encodeEventRef(index: number): EventRef {
  return encodeEntityRef('event', EVENT_REF_OFFSET, MAX_EVENT_REF_INDEX, index);
}

/** Encodes one chunk-local event row into a compact event ref. */
export function encodeEventRefFromChunkRow(chunkIndex: number, rowIndex: number): EventRef {
  return encodeEventRef(
    encodeChunkRowEntityRefPayload('event', chunkIndex, rowIndex, MAX_EVENT_REF_CHUNK_INDEX)
  );
}

/** Encodes one stable instant index into a compact instant ref. */
export function encodeInstantRef(index: number): InstantRef {
  return encodeEntityRef('instant', INSTANT_REF_OFFSET, MAX_INSTANT_REF_INDEX, index);
}

/** Encodes one chunk-local instant row into a compact instant ref. */
export function encodeInstantRefFromChunkRow(chunkIndex: number, rowIndex: number): InstantRef {
  return encodeInstantRef(
    encodeChunkRowEntityRefPayload('instant', chunkIndex, rowIndex, MAX_INSTANT_REF_CHUNK_INDEX)
  );
}

/** Encodes one stable counter index into a compact counter ref. */
export function encodeCounterRef(index: number): CounterRef {
  return encodeEntityRef('counter', COUNTER_REF_OFFSET, MAX_COUNTER_REF_INDEX, index);
}

/** Encodes one chunk-local counter row into a compact counter ref. */
export function encodeCounterRefFromChunkRow(chunkIndex: number, rowIndex: number): CounterRef {
  return encodeCounterRef(
    encodeChunkRowEntityRefPayload('counter', chunkIndex, rowIndex, MAX_COUNTER_REF_CHUNK_INDEX)
  );
}

/** Encodes one loaded storage chunk index into a compact chunk ref. */
export function encodeChunkRef(index: number): ChunkRef {
  return encodeEntityRef('chunk', CHUNK_REF_OFFSET, MAX_CHUNK_REF_INDEX, index);
}

/**
 * Marks one local dependency row index as packable in a local dependency ref.
 */
export function isLocalDependencyRefRowIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < LOCAL_DEPENDENCY_REF_OFFSET;
}

/**
 * Marks one encoded dependency reference as a local dependency row reference.
 */
export function isLocalDependencyRef(value: number): value is LocalDependencyRef {
  return (
    Number.isSafeInteger(value) && value >= LOCAL_DEPENDENCY_REF_OFFSET && value < EVENT_REF_OFFSET
  );
}

/**
 * Marks one encoded dependency reference as a cross-process dependency index reference.
 */
export function isCrossDependencyRef(value: number): value is CrossDependencyRef {
  return (
    Number.isSafeInteger(value) && value >= CROSS_DEPENDENCY_REF_OFFSET && value < THREAD_REF_OFFSET
  );
}

/**
 * Marks one encoded reference as a visible local dependency reference.
 */
export function isVisibleLocalDependencyRef(value: number): value is VisibleLocalDependencyRef {
  return isValidVisibleDependencyRef(value) && value < VISIBLE_CROSS_DEPENDENCY_REF_OFFSET;
}

/**
 * Marks one encoded reference as a visible cross dependency reference.
 */
export function isVisibleCrossDependencyRef(value: number): value is VisibleCrossDependencyRef {
  return (
    isValidVisibleDependencyRef(value) &&
    value >= VISIBLE_CROSS_DEPENDENCY_REF_OFFSET &&
    value < VISIBLE_CROSS_DEPENDENCY_REF_OFFSET + MAX_VISIBLE_DEPENDENCY_INDEX + 1
  );
}

/**
 * Decodes one tagged visible dependency reference into a local dependency-row index.
 */
export function decodeVisibleLocalDependencyRef(value: number): number | null {
  if (!isVisibleLocalDependencyRef(value)) {
    return null;
  }

  const dependencyIndex = getVisibleLocalDependencyRefIndex(value);
  if (!Number.isInteger(dependencyIndex) || dependencyIndex < 0) {
    return null;
  }
  if (dependencyIndex > MAX_VISIBLE_DEPENDENCY_INDEX) {
    return null;
  }
  return dependencyIndex;
}

/**
 * Decodes one tagged visible dependency reference into a cross dependency-row index.
 */
export function decodeVisibleCrossDependencyRef(value: number): number | null {
  if (!isVisibleCrossDependencyRef(value)) {
    return null;
  }

  const dependencyIndex = getVisibleCrossDependencyRefIndex(value);
  if (!Number.isInteger(dependencyIndex) || dependencyIndex < 0) {
    return null;
  }
  if (dependencyIndex > MAX_VISIBLE_DEPENDENCY_INDEX) {
    return null;
  }
  return dependencyIndex;
}

/**
 * Encodes one visible local dependency row index into a compact reference.
 */
export function encodeVisibleLocalDependencyRef(index: number): VisibleLocalDependencyRef {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Visible local dependency index must be a safe integer: ${index}`);
  }
  if (index > MAX_VISIBLE_DEPENDENCY_INDEX) {
    throw new Error(
      `Visible local dependency index must not exceed ${MAX_VISIBLE_DEPENDENCY_INDEX}: ${index}`
    );
  }
  return brand<'visible-local-dependency-ref', number>(VISIBLE_LOCAL_DEPENDENCY_REF_OFFSET + index);
}

/**
 * Encodes one visible cross dependency index into a compact reference.
 */
export function encodeVisibleCrossDependencyRef(index: number): VisibleCrossDependencyRef {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Visible cross dependency index must be a safe integer: ${index}`);
  }
  if (index > MAX_VISIBLE_DEPENDENCY_INDEX) {
    throw new Error(
      `Visible cross dependency index must not exceed ${MAX_VISIBLE_DEPENDENCY_INDEX}: ${index}`
    );
  }
  return brand<'visible-cross-dependency-ref', number>(VISIBLE_CROSS_DEPENDENCY_REF_OFFSET + index);
}

/**
 * Decodes one tagged local dependency reference into its packed dependency-row span ref.
 */
export function decodeLocalDependencySpanRef(value: number): LocalSpanRef | null {
  if (!isLocalDependencyRef(value)) {
    return null;
  }

  const dependencySpanRef = getLocalDependencyRefPayload(value);
  if (!Number.isInteger(dependencySpanRef) || dependencySpanRef < 0) {
    return null;
  }
  if (dependencySpanRef > MAX_SPAN_REF) {
    return null;
  }
  return dependencySpanRef as LocalSpanRef;
}

/**
 * Decodes one tagged local dependency reference into a local dependency row index.
 */
export function decodeTaggedLocalDependencyRef(
  value: number,
  localDependencyCount: number
): number | null {
  const dependencySpanRef = decodeLocalDependencySpanRef(value);
  if (dependencySpanRef == null) {
    return null;
  }
  const dependencyRowIndex = getLocalSpanRefRowIndex(dependencySpanRef);
  if (!isLocalDependencyRefRowIndex(dependencyRowIndex)) {
    return null;
  }
  if (dependencyRowIndex >= localDependencyCount) {
    return null;
  }
  return dependencyRowIndex;
}

/**
 * Decodes one tagged cross-dependency reference into a stable cross-dependency index.
 */
export function decodeCrossDependencyRef(value: number): number | null {
  if (!isCrossDependencyRef(value)) {
    return null;
  }

  const stableCrossDependencyIndex = getCrossDependencyRefIndex(value);
  if (!Number.isInteger(stableCrossDependencyIndex) || stableCrossDependencyIndex < 0) {
    return null;
  }
  if (stableCrossDependencyIndex > MAX_CROSS_DEPENDENCY_INDEX) {
    return null;
  }
  return stableCrossDependencyIndex;
}

/**
 * Encodes one packed process-local dependency row index into a compact reference.
 */
export function encodeLocalDependencyRef(localSpanRef: LocalSpanRef): LocalDependencyRef {
  const processIndex = getLocalSpanRefProcessIndex(localSpanRef);
  if (processIndex > MAX_LOCAL_DEPENDENCY_REF_PROCESS_INDEX) {
    throw new Error(
      `Local dependency ref process index must not exceed ${MAX_LOCAL_DEPENDENCY_REF_PROCESS_INDEX}: ${processIndex}`
    );
  }
  return brand<'local-dependency-ref', number>(LOCAL_DEPENDENCY_REF_OFFSET + localSpanRef);
}

/**
 * Encodes one stable cross-dependency index into a compact reference.
 */
export function encodeCrossDependencyRef(stableCrossDependencyIndex: number): CrossDependencyRef {
  if (!Number.isInteger(stableCrossDependencyIndex) || stableCrossDependencyIndex < 0) {
    throw new Error(`Cross dependency index must be a safe integer: ${stableCrossDependencyIndex}`);
  }
  if (stableCrossDependencyIndex > MAX_CROSS_DEPENDENCY_INDEX) {
    throw new Error(
      `Cross dependency index must not exceed ${MAX_CROSS_DEPENDENCY_INDEX}: ${stableCrossDependencyIndex}`
    );
  }
  return brand<'cross-dependency-ref', number>(
    CROSS_DEPENDENCY_REF_OFFSET + stableCrossDependencyIndex
  );
}

function isValidVisibleDependencyRef(value: number): value is VisibleDependencyRef {
  return (
    Number.isSafeInteger(value) &&
    value >= VISIBLE_LOCAL_DEPENDENCY_REF_OFFSET &&
    value < SAFE_INTEGER_REF_SPACE
  );
}

/**
 * Encodes one chunk-row entity payload while validating its chunk storage address.
 */
function encodeChunkRowEntityRefPayload(
  refKind: 'event' | 'instant' | 'counter',
  chunkIndex: number,
  rowIndex: number,
  maxChunkIndex: number
): number {
  assertRefComponent(`${refKind} chunkIndex`, chunkIndex, maxChunkIndex);
  assertRefComponent(`${refKind} rowIndex`, rowIndex, MAX_CHUNK_ROW_ENTITY_REF_ROW_INDEX);
  return chunkIndex * CHUNK_ROW_REF_FACTOR + rowIndex;
}

/** Checks whether a number can be interpreted as one runtime ref value. */
function isValidRuntimeRefValue(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value < SAFE_INTEGER_REF_SPACE;
}

function isEntityRefInRange(value: number, offset: number, maxIndex: number): boolean {
  return Number.isSafeInteger(value) && value >= offset && value <= offset + maxIndex;
}

function encodeEntityRef<Label extends string, RefT extends BrandedEntityRef<Label>>(
  entityName: string,
  offset: number,
  maxIndex: number,
  index: number
): RefT {
  assertRefComponent(`${entityName} ref index`, index, maxIndex);
  return brand<Label, number>(offset + index) as RefT;
}

function assertRefComponent(componentName: string, value: number, maxValue: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maxValue) {
    throw new Error(`${componentName} must be an integer between 0 and ${maxValue}: ${value}`);
  }
}

/**
 * Packs one chunk index and chunk-local span row index into one safe-integer {@link SpanRef}.
 */
export function encodeSpanRef(chunkIndex: number, rowIndex: number): SpanRef {
  assertSpanRefComponent('chunkIndex', chunkIndex);
  assertSpanRefComponent('rowIndex', rowIndex);
  return brand<'span-ref', number>(chunkIndex * SPAN_REF_ROW_FACTOR + rowIndex);
}

/**
 * Packs one process index and process-local row index into one safe-integer {@link LocalSpanRef}.
 */
export function encodeLocalSpanRef(processIndex: number, rowIndex: number): LocalSpanRef {
  assertSpanRefComponent('chunkIndex', processIndex);
  assertSpanRefComponent('rowIndex', rowIndex);
  return brand<'local-span-ref', number>(processIndex * SPAN_REF_ROW_FACTOR + rowIndex);
}

/**
 * Extracts the packed chunk index from one {@link SpanRef}.
 */
export function getSpanRefChunkIndex(spanRef: SpanRef): number {
  return Math.floor((spanRef as number) / SPAN_REF_ROW_FACTOR);
}

/**
 * Extracts the packed chunk-local row index from one {@link SpanRef}.
 */
export function getSpanRefRowIndex(spanRef: SpanRef): number {
  return (spanRef as number) % SPAN_REF_ROW_FACTOR;
}

/**
 * Extracts the packed process index from one {@link LocalSpanRef}.
 */
export function getLocalSpanRefProcessIndex(localSpanRef: LocalSpanRef): number {
  return Math.floor((localSpanRef as number) / SPAN_REF_ROW_FACTOR);
}

/**
 * Extracts the packed process-local row index from one {@link LocalSpanRef}.
 */
export function getLocalSpanRefRowIndex(localSpanRef: LocalSpanRef): number {
  return (localSpanRef as number) % SPAN_REF_ROW_FACTOR;
}

/**
 * Resolves the owning process id for one chunk-backed {@link SpanRef}.
 *
 * This is process-backed while each loaded chunk maps one-to-one with a process.
 */
export function getSpanRefProcessId(
  processIdsByIndex: readonly TraceProcessId[],
  spanRef: SpanRef
): TraceProcessId | null {
  return processIdsByIndex[getSpanRefChunkIndex(spanRef)] ?? null;
}

/**
 * Encodes stable process ids into compact process indexes and packed span references.
 */
export class TraceIdEncoder {
  #processIdMap: Map<TraceProcessId, number>;
  #processIdsByIndex: TraceProcessId[];

  /**
   * Preloads the encoder with process ids in canonical graph order when provided.
   */
  constructor(processIds: readonly TraceProcessId[] = []) {
    this.#processIdMap = new Map();
    this.#processIdsByIndex = [];
    for (const processId of processIds) {
      this.getProcessIndex(processId);
    }
  }

  /**
   * Returns the stable process index for one process id, allocating a new index when needed.
   */
  getProcessIndex(processId: TraceProcessId): number {
    const existingIndex = this.#processIdMap.get(processId);
    if (existingIndex != null) {
      return existingIndex;
    }

    const processIndex = this.#processIdsByIndex.length;
    assertSpanRefComponent('chunkIndex', processIndex);
    this.#processIdMap.set(processId, processIndex);
    this.#processIdsByIndex.push(processId);
    return processIndex;
  }

  /**
   * Returns the canonical process-id table indexed by packed process index.
   */
  getProcessIdsByIndex(): readonly TraceProcessId[] {
    return this.#processIdsByIndex;
  }

  /**
   * Packs one chunk-local row into a compact {@link SpanRef}.
   */
  getSpanRef(processId: TraceProcessId, rowIndex: number): SpanRef {
    return encodeSpanRef(this.getProcessIndex(processId), rowIndex);
  }

  /**
   * Resolves the owning process id for one packed span ref.
   */
  getProcessIdFromSpanRef(spanRef: SpanRef): TraceProcessId | null {
    return getSpanRefProcessId(this.#processIdsByIndex, spanRef);
  }

  /**
   * Resolves the chunk-local row index for one packed span ref.
   */
  getRowFromSpanRef(spanRef: SpanRef): number {
    return getSpanRefRowIndex(spanRef);
  }
}

function assertSpanRefComponent(componentName: 'chunkIndex' | 'rowIndex', value: number): void {
  const maxValue =
    componentName === 'chunkIndex' ? MAX_SPAN_REF_CHUNK_INDEX : MAX_SPAN_REF_ROW_INDEX;
  if (!Number.isSafeInteger(value) || value < 0 || value > maxValue) {
    throw new Error(
      `TraceIdEncoder ${componentName} must be an integer between 0 and ${maxValue}: ${value}`
    );
  }
}
