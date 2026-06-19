# Trace Style And Color Schemes

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`TraceStyle` controls shared visual dimensions and labels. `TraceColorScheme` decides source-aware
colors for spans, threads, processes, keywords, and dependencies.

```ts
import {
  DEFAULT_TRACE_COLOR_SCHEME,
  DEFAULT_TRACE_STYLE,
  makeTraceStyle,
  type TraceColorScheme,
  type TraceStyle
} from '@deck.gl-community/trace-layers/trace';
```

## TraceStyle

Use `DEFAULT_TRACE_STYLE` for the standard viewer look. Use `makeTraceStyle(...)` when a host needs
to change shared dimensions, labels, or typography without forking layout/rendering behavior.

## TraceColorScheme

`TraceColorScheme` can provide:

- keyword presentation
- span fill, border, text, and composite styles
- thread colors
- process background colors

Built-in schemes include `DEFAULT_TRACE_COLOR_SCHEME`, `PERFETTO_TRACE_COLOR_SCHEME`, and
`PROCESS_TRACE_COLOR_SCHEME`. Chrome Trace integrations can use `createChromeTraceColorScheme(...)`.

## Related helpers

- `createTraceColorResolver(...)`
- `createTraceGraphColorResolver(...)`
- `getReadableSpanBorderColor(...)`
- `computeTracePathHighlighting(...)`

Pass a scheme to `DeckTraceGraph.colorScheme`. Keep the scheme source-aware and keep application
state outside it.
