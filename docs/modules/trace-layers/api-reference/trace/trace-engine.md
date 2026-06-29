# TraceEngine

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`TraceEngine` owns mounted trace-view state below React. Hosts sync durable inputs into it, dispatch
semantic interactions into it, and subscribe when selected refs or serialized expanded process ids
need to be persisted.

```ts
import {TraceEngine} from '@deck.gl-community/trace-layers/trace';
```

## Main operations

- `new TraceEngine(inputs)`: mount one engine around primary and optional secondary graphs
- `sync(inputs)`: replace durable host inputs without remounting the viewer
- `dispatch(action)`: apply semantic selection and collapse interactions
- `subscribe(listener)`: receive `TraceEngineUpdate` notifications
- `getSnapshot()`: read the immutable renderer snapshot consumed by `DeckTraceGraph`
- `getPreparedScene()`: read prepared foreground and overview scenes for low-level composition
- `getDiagnostics(...)`: read cheap engine diagnostics and optional retained-size estimates

## Host boundary

Keep durable host state small: `TraceGraph`, settings, paths, selected `SpanRef`s, color scheme,
and serialized expanded process ids. Let the mounted engine own transient selected dependency refs,
collapse runtime state, prepared layouts, and prepared scenes.

See [DeckTraceGraph](../react/deck-trace-graph.md) and
[Rendering traces](../../developer-guide/rendering-traces.md).
