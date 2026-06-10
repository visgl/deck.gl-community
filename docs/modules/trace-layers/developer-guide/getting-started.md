# Getting Started

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

The shortest useful integration is: normalize data, construct a `TraceGraph`, then render
`DeckTraceGraph`. The host application owns uploaded files, settings persistence, selection state,
collapse state, and any product-specific panels.

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

`DeckTraceGraph` is controlled. Pass the graph plus the settings, selection, and collapse state your
application owns:

```tsx
import {DEFAULT_TRACE_STYLE} from '@deck.gl-community/trace-layers/trace';
import {DeckTraceGraph, TRACEVIS_SHORTCUTS} from '@deck.gl-community/trace-layers/react';

export function TraceViewer({traceGraph, settings, collapseState}) {
  return (
    <DeckTraceGraph
      traceGraph={traceGraph}
      traceStyle={DEFAULT_TRACE_STYLE}
      settings={settings}
      collapseState={collapseState}
      selectedSpanRefs={[]}
      paths={[]}
      keyboardShortcuts={TRACEVIS_SHORTCUTS}
      onAllProcessesExpansionChange={() => {}}
      onProcessCollapseToggle={() => {}}
      onThreadCollapseToggle={() => {}}
      onThreadCollapsePrune={() => {}}
      onTimeRangeSelectionChange={() => {}}
    />
  );
}
```

Use the collapse runtime helpers when you want the package to manage ref-native process/thread
collapse transitions for one or two displayed graphs.

## Add application behavior

Common next steps:

- use `onSelectionChange` to keep selected `SpanRef`s in app state
- pass `secondaryTraceGraph` for compare mode
- pass `colorScheme` for source-specific span and process colors
- pass `renderTraceEventCard` for source-specific graph-global event details
- pass `externalOmniBoxSearchProvider` when search must include host-owned records

Read [Rendering traces](./rendering-traces.md) for the render pipeline and
[DeckTraceGraph](../api-reference/react/deck-trace-graph.md) for the full prop surface.
