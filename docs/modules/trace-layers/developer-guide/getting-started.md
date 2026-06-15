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
  const {ranks, crossDependencies} = buildTraceRanksFromChromeTrace(chromeTrace);
  const jsonTrace = buildJSONTrace(ranks, crossDependencies, {name: 'Chrome Trace'});
  const trace = materializeJSONTrace(jsonTrace);

  return new TraceGraph(
    createStaticTraceGraphRuntimeSource({
      identityKey: 'chrome-trace',
      name: trace.name,
      spanLayout: trace.spanLayout,
      chunks: buildTraceChunkDataFromJSONTrace(trace),
      crossDependencies: trace.crossDependencies,
      events: trace.events,
      timeExtents: {minTimeMs: trace.minTimeMs, maxTimeMs: trace.maxTimeMs},
      stats: trace.stats
    })
  );
}
```

If your source is not Chrome Trace, normalize it into `JSONTrace`, `TraceGraphData`, or
`TraceChunkData` before constructing the graph. Source-specific payloads should not reach layout or
rendering code.

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
