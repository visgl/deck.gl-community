# Developer Guide

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

Use these pages when the question is "how do I build this?" rather than "what fields does this
type expose?" The guide follows the normal integration path from source data to an interactive
viewer.

## Read in this order

- [Getting started](./getting-started.md): build and render one trace.
- [Data model](./data-model.md): understand processes, threads, spans, refs, graphs, and layouts.
- [Loading traces](./loading-traces.md): choose static, process-sliced, time-sliced, or streaming loading.
- [Incremental ingestion](./incremental-ingestion.md): feed bounded chunks into `TraceChunkStore`.
- [Filtering traces](./filtering-traces.md): hide spans without destroying useful topology.
- [Rendering traces](./rendering-traces.md): understand the React and low-level deck.gl render path.
- [Working with Chrome Trace](./chrome-trace.md): parse, stream, and write Chrome Trace data.

For exact exported contracts, switch to the [API reference](../api-reference/README.md).
