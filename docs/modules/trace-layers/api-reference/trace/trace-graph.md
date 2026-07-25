# TraceGraph

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`TraceGraph` is the dataset-backed runtime/query facade for loaded Arrow trace data. It borrows one
canonical `TraceDataset` plus one immutable `TraceViewSnapshot`, then exposes ref lookup,
filtering, dependency traversal, search, cards, and the metadata layout/rendering need.

```ts
import {buildTraceViewSnapshot, TraceGraph} from '@deck.gl-community/trace-layers/trace';
```

## Construction

Construct it from a `TraceGraphRuntimeSource`. For static normalized data, use
`createStaticTraceGraphRuntimeSource(...)`. For custom runtime sources, provide
`{traceDataset, traceStore}` and build a dataset-identical `TraceViewSnapshot`.

```ts
const traceViewSnapshot = buildTraceViewSnapshot(runtimeSource.traceDataset, {
  spanFilters
});
const graph = new TraceGraph(runtimeSource, traceViewSnapshot);
```

## What it owns

- dataset-owned chunks and graph-wide metadata
- one dataset-identical view snapshot with visibility masks
- process-local span-ref indexes
- same-process and cross-process dependency lookup
- process, thread, span, event, instant, and counter accessors
- span filter reasons read from the view snapshot
- search and hidden-span navigation
- visible render sources consumed by layout and cards

## Method groups

Use exact ref methods when you already have a `SpanRef`:

- `isSpanVisible(...)`
- `spanIsFiltered(...)`
- `spanFilterReason(...)`
- `getProcessRefBySpanRef(...)`
- `getThreadRefBySpanRef(...)`
- `getTraceSpanFilterNavigation(...)`
- exported `getTraceSpanDependencyChain(...)` and `getTraceSpanCardModel(...)`

Use visible graph methods for layout/render work:

- `iterateVisibleSpanRefsByProcess(...)`
- `iterateVisibleSameProcessDependencyRefsByProcess(...)`
- `iterateVisibleCrossProcessDependencyRefs(...)`
- `getSpanGeometrySource(...)`
- `getDependencySource(...)`

Use search and navigation methods for UI:

- `searchSpans(...)`
- `getTraceSpanFilterNavigation(...)`
- `getTraceSpanFilteredParentRef(...)`

Built-in Omnibox search passes a predicate from `createTraceSpanOmniBoxSearchPredicate(...)`.
Loaded chunks and store rows return a case-sensitive exact `external_span_id` match before fuzzy
name/source/keyword matches, then deduplicate that exact row from the text results. Other callers
can continue passing `createTraceSpanNameSearchPredicate(...)` or their own text predicate when
they do not want exact external-id priority.

## Rebuild rule

Build a new `TraceViewSnapshot` and `TraceGraph` when loaded data or filter semantics change. Reuse
them when only collapse state, timing projection, geometry, color, or other render settings change.

See [Filtering traces](../../developer-guide/filtering-traces.md),
[TraceDataset](./trace-dataset.md), [TraceViewSnapshot](./trace-view-snapshot.md), and
[TraceLayout](./trace-layout.md).
