# Getting Started

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

The shortest useful integration is: normalize data, construct a `TraceGraph`, mount a
`TraceEngine`, then render `DeckTraceGraph`. The host application owns uploaded files, durable
settings, durable selected span refs, durable expanded process ids, and any product-specific
panels.

## Build a graph

For Chrome Trace JSON, use the built-in parser and normalization helpers:

```ts
import {
  buildJSONTrace,
  buildTraceChunkDataFromJSONTrace,
  buildTraceRanksFromChromeTrace,
  createStaticTraceGraphRuntimeSource,
  materializeJSONTrace,
  parseChromeTrace,
  TraceGraph
} from '@deck.gl-community/trace-layers/trace';

export function buildChromeTraceGraph(traceJson: unknown): TraceGraph {
  const chromeTrace = parseChromeTrace(traceJson);
  const {ranks, crossProcessDependencies} = buildTraceRanksFromChromeTrace(chromeTrace);
  const jsonTrace = buildJSONTrace(ranks, crossProcessDependencies, {name: 'Chrome Trace'});
  const trace = materializeJSONTrace(jsonTrace);

  return new TraceGraph(
    createStaticTraceGraphRuntimeSource({
      identityKey: 'chrome-trace',
      name: trace.name,
      spanLayout: trace.spanLayout,
      chunks: buildTraceChunkDataFromJSONTrace(trace),
      crossProcessDependencies: trace.crossProcessDependencies,
      events: trace.events,
      timeExtents: {minTimeMs: trace.minTimeMs, maxTimeMs: trace.maxTimeMs},
      stats: trace.stats
    })
  );
}
```

If your source is not Chrome Trace, normalize it into `JSONTrace` or parser-local
`TraceChunkData`. Static sources use `createStaticTraceGraphRuntimeSource(...)` to finalize chunks
into a `TraceDataset`; incremental sources assemble a selected `TraceDataset` from ready store
chunks. Source-specific payloads should not reach layout or rendering code.

## Render the graph

`DeckTraceGraph` renders one mounted `TraceEngine`. Sync durable host inputs into the engine, then
pass the engine plus React-only viewer configuration:

```tsx
import {useLayoutEffect, useMemo} from 'react';
import {DEFAULT_TRACE_STYLE, TraceEngine} from '@deck.gl-community/trace-layers/trace';
import {DeckTraceGraph, TRACEVIS_SHORTCUTS} from '@deck.gl-community/trace-layers/react';

export function TraceViewer({traceGraph, settings, selectedSpanRefs}) {
  const engine = useMemo(
    () =>
      new TraceEngine({
        traceGraph,
        traceStyle: DEFAULT_TRACE_STYLE,
        paths: [],
        settings,
        selectedSpanRefs,
        defaultExpandProcess: true
      }),
    [traceGraph]
  );

  useLayoutEffect(() => {
    engine.sync({
      traceGraph,
      traceStyle: DEFAULT_TRACE_STYLE,
      paths: [],
      settings,
      selectedSpanRefs,
      defaultExpandProcess: true
    });
  }, [engine, selectedSpanRefs, settings, traceGraph]);

  return (
    <DeckTraceGraph
      engine={engine}
      reactConfig={{keyboardShortcuts: TRACEVIS_SHORTCUTS}}
    />
  );
}
```

Subscribe to `TraceEngine` updates when the host needs to persist `selectedSpanRefs` or serialized
expanded process ids after interactions.

## Understand the runtime boundary

The graph built above is dataset-backed even though the example starts from JSON. The full path is:

1. `buildJSONTrace(...)` creates a JSON-safe normalized document.
2. `materializeJSONTrace(...)` rebuilds low-frequency compatibility indexes and stats.
3. `buildTraceChunkDataFromJSONTrace(...)` creates parser-local columnar chunks.
4. `createStaticTraceGraphRuntimeSource(...)` finalizes those chunks into `TraceDataset`.
5. `TraceGraph` borrows that dataset plus an unfiltered `TraceViewSnapshot`.
6. `TraceEngine` turns the graph into `TraceLayout` and `TraceRenderSnapshot` state for the viewer.

When filter semantics change, build a new `TraceViewSnapshot` and `TraceGraph`; do not rewrite the
canonical dataset tables.

## Add application behavior

Common next steps:

- subscribe to engine updates to persist selected `SpanRef`s and expanded process ids
- sync `secondaryTraceGraph` into the engine for compare mode
- sync `colorScheme` into the engine for source-specific span and process colors
- pass `renderTraceEventCard` in `reactConfig` for source-specific graph-global event details
- pass `externalOmniBoxSearchProvider` in `reactConfig` when search must include host-owned records

Read [Rendering traces](./rendering-traces.md) for the render pipeline and
[DeckTraceGraph](../api-reference/react/deck-trace-graph.md) plus
[TraceEngine](../api-reference/trace/trace-engine.md) for the mounted viewer contract.
