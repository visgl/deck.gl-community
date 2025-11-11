---
title: ClassicGraph
---

# ClassicGraph

`ClassicGraph` is a mutable in-memory implementation of the [`Graph`](./graph.md) interface. It is the
backing structure used by existing layouts and widgets that expect the original deck.gl graph API.

## Storage strategy

ClassicGraph stores [`Node`](./node.md) and [`Edge`](./edge.md) class instances directly. Each node or
edge owns its state (`data`, `state`, connectivity metadata) and mutations operate on the object
itself. Because all state lives on the instances, consumers can hold on to node/edge references while
mutating the graph without additional bookkeeping.

## Usage notes

- `ClassicGraph` is ideal when your pipeline already produces `Node` and `Edge` instances or when you
  need to build graphs incrementally at runtime.
- Use `batchAddNodes()` / `batchAddEdges()` when loading large datasets to avoid repeated reflows of
  the internal maps.
- For tabular or externally owned datasets prefer [`TabularGraph`](./tabular-graph.md), which stores
  state separately from the raw handles and works better with immutable data sources.
