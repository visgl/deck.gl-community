# Incremental Ingestion

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
  <img src="https://img.shields.io/badge/status-work--in--progress-orange.svg?style=flat-square" alt="status Work-in-Progress" />
</p>

Use `TraceChunkData` when a loader fetches bounded source chunks and the application wants
`TraceChunkStore` to retain, search, and materialize them later.

## Ownership boundary

1. Fetch raw JSON, Arrow IPC, database rows, or another source payload.
2. Normalize that payload into `TraceChunkData`.
3. Give the chunk to `TraceChunkStore.add(...)` or return it from a store `loadChunk` callback.
4. Let the store finalize it into a store-owned `TraceChunk`.
5. Materialize a visible `TraceGraphData` / `TraceGraph` snapshot for the active window.

After step 3, treat the parser-local `TraceChunkData` as consumed.

## Required fields

Every normalized chunk needs:

- `type: 'trace-chunk-data'`
- `chunkKey`
- `processes`
- `spanTable`
- `localDependencyTable`
- `diagnostics`
- `refState: 'parser-local'`

Add `spanSidecarTable`, `sourceDependencyTable`, and `rowWindowTable` when your source can provide
display sidecars, cross-chunk source edges, or row-level overlap windows.

## Stable external span IDs

Populate `external_span_id` whenever the source has one. Hidden search, URL serialization, parent
navigation, and cross-chunk source dependency resolution depend on stable source identity.

Parent pointers belong in `sourceDependencyTable`, not in a second parent-only payload:

```ts
buildTraceChunkSourceDependencyTable([
  {
    dependencyKind: 'parent',
    startExternalSpanId: 'head:1',
    endExternalSpanId: 'head:2',
    waitMode: 'start-to-start'
  }
]);
```

## Window overlap

Use `rowWindowTable` when one retained source chunk covers more time than the currently visible
window. The store can keep all ready rows searchable while visible-window materialization selects
only rows whose overlap range intersects the active `TraceWindow`.

## Store usage

```ts
const store = new TraceChunkStore({
  identityKey,
  descriptors,
  selectionPolicy,
  windowGraphMaterializer
});

await store.registerTraceWindows({
  windows,
  loadChunk: async descriptor => ingestSourceChunk(await fetchChunk(descriptor))
});
```

See [TraceChunkData](../api-reference/trace/trace-chunk-data.md) and
[TraceChunkStore](../api-reference/trace/trace-chunk-store.md) for the field and method contracts.
