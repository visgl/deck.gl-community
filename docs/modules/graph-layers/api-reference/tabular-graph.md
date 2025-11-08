---
title: TabularGraph
---

# TabularGraph

`TabularGraph` adapts tabular datasets to the [`Graph`](./graph.md) interface. It accepts a
`TabularGraphSource` with iterable node and edge handles plus accessor functions for reading and
writing state back to the underlying records.

## Storage strategy

Unlike [`LegacyGraph`](./legacy-graph.md), `TabularGraph` stores node and edge state in internal tables
that are rebuilt whenever the source version changes. The tables capture:

- identifiers, directional metadata, and connectivity;
- logical state (`hover`, `selected`, etc.);
- copies of mutable data blobs exposed through the accessor interface.

Nodes and edges returned from `getNodes()` / `getEdges()` expose a `index` property of type
`NodeIndex` / `EdgeIndex`. The graph instance provides helper accessors such as
`getNodeStateByIndex()` and `getEdgeDataByIndex()` for reading or mutating the cached records without
holding onto the node or edge objects themselves.

## Usage notes

- Implement `TabularGraphSource` so that `version` increases whenever the underlying dataset changes.
  The graph rebuilds its tables lazily the next time it is accessed.
- Provide `setState` / `setData` accessors when you need updates made through the runtime to be
  reflected back into your data source.
- When working with large immutable datasets, `TabularGraph` avoids copying handles into new `Node`
  and `Edge` instances while still exposing the Graph API expected by the rendering layers.
