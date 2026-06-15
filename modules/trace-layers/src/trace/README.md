# trace

`trace` is optimized for visualizing very large traces.

## Trace Data Format

"Processes" and "Threads" are the basic hierarchical model of data, with local dependencies being dependencies between spans inside a process and

Examples:

- On a single CPU, processes and threads are often just that.
- In distributed system, `process` is often a CPU or GPU, a `thread` is a stream of operations of some type, and a `cross dependency` is an RPC between CPUs/GPUs.
- In an LLM training workload, processes might represent ranks and threads might represent streams of operations on the GPU or its associated control CPU.

## License

`trace` will be open sourced under the MIT license.
