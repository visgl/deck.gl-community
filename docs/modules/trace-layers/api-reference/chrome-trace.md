# ChromeTrace

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

`ChromeTrace` is the Chrome-specific parsed object model exported by the trace graph package. It is
an intermediate source-format model, not the final normalized render contract.

```ts
import {
  ArrowChromeTraceWriter,
  ChromeTraceWriter,
  parseChromeTrace,
  parseChromeTraceToArrowRecordBatches,
  parseChromeTraceToArrowTable,
  validateChromeTraceFile,
  writeArrowChromeTrace,
  writeChromeTrace,
  type ChromeTrace
} from '@deck.gl-community/trace-layers/trace';
```

## Parser exports

- `maybeChromeTraceFile(...)`
- `validateChromeTraceFile(...)`
- `parseChromeTrace(...)`
- `parseChromeTraceToArrowTable(...)`
- `parseChromeTraceToArrowRecordBatches(...)`

The parser accepts phase-driven Chrome Trace JSON and assembles spans, instants, counters, and flows
into the Chrome-specific object model.

## Normalization export

Use `buildTraceRanksFromChromeTrace(...)` to convert parsed Chrome processes, threads, spans, and
flows into normalized trace processes and cross-process dependencies before building `JSONTrace`.

## Writer exports

- `ChromeTraceWriter`
- `ArrowChromeTraceWriter`
- `buildChromeTraceFile(...)`
- `buildArrowChromeTraceFile(...)`
- `writeChromeTrace(...)`
- `writeArrowChromeTrace(...)`

## Streaming exports

- `streamChromeTraceEventChunks(...)`
- `streamChromeTraceFileChunks(...)`
- `streamChromeTraceArrowChunks(...)`
- matching `consume...` helpers

See [Working with Chrome Trace](../developer-guide/chrome-trace.md).
