import type {TraceGraphData} from '../ingestion/arrow-trace';
import type {TraceGraphSpanFilterStore} from './trace-graph-types';

/** Store-backed immutable graph snapshot consumed by runtime `TraceGraph` instances. */
export type TraceGraphRuntimeSource<
  TTraceStore extends TraceGraphSpanFilterStore = TraceGraphSpanFilterStore
> = {
  /** Immutable Arrow graph snapshot used by layout, cards, and render-state helpers. */
  readonly traceGraphData: TraceGraphData;
  /** Store that owns loaded chunks, source filters, and store-backed span lookup. */
  readonly traceStore: TTraceStore;
};
