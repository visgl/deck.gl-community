# TraceVisSettings

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`TraceVisSettings` is the shared display settings contract used by layout, rendering, and Tracevis
UI state.

```ts
import {type TraceVisSettings} from '@deck.gl-community/trace-layers/trace';
```

## Setting groups

- dependency visibility, mode, keywords, routing, and opacity
- instants and counters
- path highlighting, fade, and transition behavior
- thread display, selected thread names, sorting, lane limits, and aggregation mode
- process layout mode and layout density
- collapsed process overview aggregation
- time offset, scale, and minimum visible span time
- span filtering
- color-scheme and timing-projection selection
- popup, minimap, interaction, and text-layer behavior

## Invalidation domains

Treat settings by the work they require:

| Domain | Examples |
| --- | --- |
| Structure | `spanFilter`, thread visibility, sorting, lane limits, aggregation mode, process layout mode, density |
| Geometry | local dependency mode, minimum span time, timing projection |
| Render only | colors, opacity, path animation, highlight fade, transitions, fast text implementation |

When adding a setting, decide its invalidation domain before wiring it into a viewer.

## Relationship to color

`TraceVisSettings` selects behavior. `TraceColorScheme` decides actual span, thread, process, keyword,
and dependency colors.

See [TraceLayout](./trace-layout.md), [Trace style and color schemes](./trace-style.md), and
[Filtering traces](../../developer-guide/filtering-traces.md).
