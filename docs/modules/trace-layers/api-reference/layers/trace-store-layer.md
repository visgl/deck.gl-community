# TraceStoreLayer

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`TraceStoreLayer` renders store-backed trace windows. It registers each source window with its
`TraceChunkStore`, redraws when matching chunks arrive, materializes `TraceGraph` snapshots with
`getTraceGraphForWindow`, and delegates resolved graphs to `TraceGraphLayer`.

```ts
import {TraceStoreLayer, type TraceStoreLayerSource} from '@deck.gl-community/trace-layers/layers';
```

## Source contract

Each `traceSources` entry provides:

- `traceChunkStore`
- `traceWindow`
- `loadChunk`
- optional `spanBudget`
- optional `onProgress`
- optional `onError`

```tsx
<DeckGL
  views={views}
  layers={[
    new TraceStoreLayer({
      id: 'trace-store',
      traceSources: [{traceChunkStore, traceWindow, loadChunk}],
      settings
    })
  ]}
/>;
```

The layer owns registration replacement and finalize cleanup for its active source list. It does not
own descriptor catalogs, graph materializer configuration, deck views, viewer widgets, tooltips, or
selection state. Use `TraceGraphLayer` when graphs are already materialized. Use `DeckTraceGraph`
for the full React viewer.

See [TraceChunkStore](../trace/trace-chunk-store.md) and
[Rendering traces](../../developer-guide/rendering-traces.md).
