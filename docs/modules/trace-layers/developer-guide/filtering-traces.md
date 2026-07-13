# Filtering Traces

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

Filtering hides spans without mutating canonical row storage. The original normalized data and
`TraceDataset` stay immutable; one `TraceViewSnapshot` owns live visibility masks, and `TraceGraph`
reads that snapshot for exact lookup, search, cards, and dependency visibility.

## Filter flow

1. Start from the canonical `TraceDataset`.
2. Evaluate text/source filters into one `TraceViewSnapshot`.
3. Store combined provenance masks only for chunks with hidden active rows.
4. Construct `TraceGraph` with that dataset-identical snapshot.
5. Let layout and render builders borrow snapshot masks directly.

`spanFilter` accepts literal prefixes and explicit regular expressions:

```ts
const filters = ['rpc.request_', 'packages/example_tracing/base.py', '/^executeRpc-\\d+$/'];
```

## Filter families

- name and regexp filtering marks spans matched by text rules
- source filtering marks spans matched by source metadata
- dependency rendering drops rows whose start or end span is hidden
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

Build a new `TraceViewSnapshot` and `TraceGraph` when source data or filter semantics change. Do
not rebuild them for collapse toggles, timing-key changes, or pure render settings. Those belong
to layout, geometry, or render updates.

Read [TraceGraph](../api-reference/trace/trace-graph.md) for the runtime methods and
[TraceVisSettings](../api-reference/trace/trace-vis-settings.md) for settings invalidation groups.
