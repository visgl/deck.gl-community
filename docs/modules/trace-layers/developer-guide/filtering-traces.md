# Filtering Traces

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

Filtering hides spans without discarding the graph relationships that still explain the visible
trace. The original normalized data stays immutable; filter state lives in `TraceGraph`.

## Filter flow

1. Start from the loaded graph.
2. Evaluate text filters and configured topology filters.
3. Record filter provenance in row-aligned process tables.
4. Build the visible graph projection used by layout and rendering.
5. Contract parent and dependency paths onto surviving visible representatives.

`spanFilter` accepts literal prefixes and explicit regular expressions:

```ts
const filters = ['rpc.request_', 'packages/distributed_tracing/base.py', '/^executeRpc-\\d+$/'];
```

## Filter families

- name and regexp filtering marks spans matched by text rules
- source filtering marks spans matched by source metadata
- topology filtering contracts structures such as overlapping parent spans or similar-duration chains
- time-window hiding is separate from graph filtering and should come from application window metadata

## Why refs matter

Use `SpanRef` when checking filtered state. Source span IDs may collide across processes, while a ref
identifies one exact loaded row.

Useful `TraceGraph` calls include:

- `spanIsFiltered(...)`
- `spanFilterReason(...)`
- `getTraceSpanFilteredParentRef(...)`
- `getTraceSpanFilterNavigation(...)`
- `searchSpans(...)`

## Invalidation

Rebuild `TraceGraph` when source data or filter semantics change. Do not rebuild it for collapse
toggles, timing-key changes, or pure render settings. Those belong to layout, geometry, or render
updates.

Read [TraceGraph](../api-reference/trace-graph.md) for the runtime methods and
[TraceVisSettings](../api-reference/trace-vis-settings.md) for settings invalidation groups.
