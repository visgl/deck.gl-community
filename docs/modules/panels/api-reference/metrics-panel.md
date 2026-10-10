# MetricsPanel

![From v9.4](https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square)

`MetricsPanel` displays a plain telemetry snapshot as a semantic description list. Use it for counts, bytes, timings, ratios, status strings, or release names. Use `StatsPanel` when your application already has a probe.gl `Stats` bag.

```ts
import {MetricsPanel} from '@deck.gl-community/panels';

const panel = new MetricsPanel({
  id: 'telemetry',
  title: 'Telemetry',
  metrics: {release: '2026-10', rows: 50, bytes: 2048},
  metricNames: ['release', 'rows', 'bytes'],
  labels: {bytes: 'Bytes read'},
  formatValue: (value, name) =>
    name === 'bytes' ? `${Number(value) / 1024} KiB` : String(value ?? '—')
});
```

## Props

- `id`, `title`: panel identity and heading.
- `metrics`: read-only object of string, number, boolean, null, or undefined values.
- `metricNames`: ordered subset; absent keys are omitted. Defaults to object insertion order.
- `labels`: optional labels by metric name.
- `formatValue(value, name)`: optional formatter returning plain text. Hosts choose units and precision. Without it, null and undefined display `—`; other values use `String(value)`.
- `theme`: standard panel theme override.

Values are escaped text, including formatter output. No timer or data subscription is created. Replace the panel definition with a new snapshot when telemetry changes; mutating the original object does not trigger a refresh.
