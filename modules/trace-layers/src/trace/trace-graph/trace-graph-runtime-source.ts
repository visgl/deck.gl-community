import type {TraceDataset} from '../trace-dataset';
import type {TraceGraphSpanLookupStore} from './trace-graph-types';

/** Dataset-owned runtime input consumed by one `TraceGraph` instance. */
export type TraceDatasetRuntimeSource<
  TTraceStore extends TraceGraphSpanLookupStore = TraceGraphSpanLookupStore
> = {
  /** Canonical immutable dataset snapshot used by layout, cards, and render-state helpers. */
  readonly traceDataset: TraceDataset;
  /** Optional store-backed lookup surface for rows outside the active dataset view. */
  readonly traceStore?: TTraceStore;
};

/**
 * Store-backed immutable runtime source with one canonical row-heavy owner.
 *
 * Runtime graph construction is dataset-only. Callers must not pair a canonical dataset with a
 * separately projected graph snapshot or bypass the dataset's active-row and owner-ref contract.
 */
export type TraceGraphRuntimeSource<
  TTraceStore extends TraceGraphSpanLookupStore = TraceGraphSpanLookupStore
> = TraceDatasetRuntimeSource<TTraceStore>;
