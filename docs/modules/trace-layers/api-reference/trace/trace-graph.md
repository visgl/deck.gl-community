# TraceGraph

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`TraceGraph` is the runtime class for loaded Arrow-backed trace data. It owns ref lookup, visible
graph projection, filter state, dependency traversal, search, and the metadata layout/rendering
need.

```ts
import {TraceGraph} from '@deck.gl-community/trace-layers/trace';
```

## Construction

Construct it from a `TraceGraphRuntimeSource`. For static normalized data, use
`createStaticTraceGraphRuntimeSource(...)`. For custom runtime sources, use
`createTraceGraphRuntimeSource(...)`.

```ts
const graph = new TraceGraph(runtimeSource, {
  spanFilters,
  overlappingParentSpanFilter,
  similarDurationChainSpanFilter
});
```

## What it owns

- loaded chunks and graph-wide metadata
- process-local span-ref indexes
- source and visible dependency lookup
- process, thread, span, event, instant, and counter accessors
- span filter masks and filter reasons
- search and hidden-span navigation
- visible render sources consumed by layout and cards

## Method groups

Use exact ref methods when you already have a `SpanRef`:

- `spanIsFiltered(...)`
- `spanFilterReason(...)`
- `getProcessRefBySpanRef(...)`
- `getThreadRefBySpanRef(...)`
- `getDependencyChainBySpanRef(...)`
- `getTraceSpanCardModel(...)`

Use visible graph methods for layout/render work:

- `getVisibleProcessRefs(...)`
- `getVisibleProcessRenderSpans(...)`
- `getVisibleLocalDependencySources(...)`
- `getVisibleCrossDependencySources(...)`
- `getVisiblePathData(...)`

Use search and navigation methods for UI:

- `searchSpans(...)`
- `getTraceSpanFilterNavigation(...)`
- `getTraceSpanFilteredParentRef(...)`

## Rebuild rule

Rebuild the graph when loaded data or filter semantics change. Reuse it when only collapse state,
timing projection, geometry, color, or other render settings change.

See [Filtering traces](../../developer-guide/filtering-traces.md) and
[TraceLayout](./trace-layout.md).
