# Working With Chrome Trace

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

Chrome Trace is a phase-driven JSON event format with a top-level `traceEvents` array. The trace
layers package can validate it, parse it into a Chrome-specific object model, normalize it into the
shared trace model, stream it, and write normalized traces back to Chrome Trace JSON.

## Static file path

```ts
import {
  buildJSONTrace,
  buildTraceRanksFromChromeTrace,
  parseChromeTrace,
  validateChromeTraceFile
} from '@deck.gl-community/trace-layers/trace';

const file = validateChromeTraceFile(JSON.parse(traceText));
const chromeTrace = parseChromeTrace(file);
const {ranks, crossDependencies} = buildTraceRanksFromChromeTrace(chromeTrace);
const jsonTrace = buildJSONTrace(ranks, crossDependencies, {name: 'Chrome Trace'});
```

The parser assembles duration spans from `B`/`E` and `X` events, normalizes instants and counters,
and preserves flows for later dependency building.

## Arrow path

Use `parseChromeTraceToArrowTable(...)` or `parseChromeTraceToArrowRecordBatches(...)` when the
source is large enough that Arrow transport is useful before full graph normalization.

## Streaming path

Use `streamChromeTraceEventChunks(...)`, `streamChromeTraceFileChunks(...)`, or
`streamChromeTraceArrowChunks(...)` when input arrives incrementally. Feed the resulting chunks into
a `TraceStreamSession` and render only published snapshots.

## Writing

Use `writeChromeTrace(...)` or `ChromeTraceWriter.encode(...)` for normalized JSON traces. Use
`writeArrowChromeTrace(...)` or `ArrowChromeTraceWriter.encode(...)` when exporting Arrow-backed
`TraceGraphData`.

## Format notes

Raw Chrome Trace timestamps are commonly microseconds. The normalized trace model uses
milliseconds, and writers convert back when emitting Chrome Trace JSON.

Read [ChromeTrace](../api-reference/trace/chrome-trace.md) for the exported parser/writer contracts and
[TraceStreamSession](../api-reference/trace/trace-stream-session.md) for the streaming runtime.
