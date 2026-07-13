# layers

`layers` owns the deck.gl rendering primitives, controllers, and low-level OSS wrapper layers for
dataset-backed trace graphs.

## Trace Data Format

"Processes" and "Threads" are the basic hierarchical model. Same-process dependencies connect
spans inside one process; cross-process dependencies connect spans across processes.

Examples:

- On a single CPU, processes and threads are often just that.
- In a distributed system, `process` is often a CPU or GPU, a `thread` is a stream of
  operations of some type, and a `cross-process dependency` is an RPC between CPUs/GPUs.
- In a distributed compute workload, processes might represent ranks and threads might represent
  streams of operations on a GPU or its associated control CPU.

## Wrapper Layers

- `TracePreparedStateLayer` renders `TraceViewState.renderSnapshot`.
- `TraceGraphLayer` builds current `TraceViewState` from dataset-backed `TraceGraph` inputs.
- `TraceStoreLayer` loads `TraceChunkStoreWindow` sources, materializes `TraceDataset`, wraps it in
  `TraceGraph`, and delegates to `TraceGraphLayer`.

## License

`layers` is licensed under the repository MIT license.
