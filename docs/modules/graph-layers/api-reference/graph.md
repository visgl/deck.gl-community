---
title: Graph Interface
---

# Graph Interface

The `Graph` interface is the runtime abstraction consumed by the graph-layers module. It presents a
stable API for enumerating nodes and edges plus inspecting or mutating their state through
[`NodeInterface`](./node.md) and [`EdgeInterface`](./edge.md). Concrete implementations such as
[`LegacyGraph`](./legacy-graph.md) and [`TabularGraph`](./tabular-graph.md) provide different storage
strategies while conforming to the same contract.

## Shape

### `version`

`number` &mdash; Monotonically increasing revision counter supplied by the graph implementation. The
value updates whenever nodes, edges, or their state change.

### `getNodes()`

Returns an iterable sequence of [`NodeInterface`](./node.md) instances.

### `getEdges()`

Returns an iterable sequence of [`EdgeInterface`](./edge.md) instances.

### `findNodeById(id)` _(optional)_

Returns a node handle with the provided identifier when supported by the implementation.

### `createStylesheetEngine(style, options?)`

Creates a `GraphStyleEngine` for evaluating stylesheets against the current graph state. Most
applications interact with this through the [`GraphLayer`](./layers/graph-layer.md).

### `destroy()` _(optional)_

Releases any resources owned by the graph implementation.

## NodeInterface

Nodes returned by `getNodes()` implement the following methods:

- `getId()` &mdash; Returns the node identifier supplied by the data source.
- `getConnectedEdges()` &mdash; Returns the edges that reference the node.
- `getDegree()`, `getInDegree()`, `getOutDegree()` &mdash; Connectivity helpers.
- `getSiblingIds()` &mdash; Returns the identifiers of nodes connected via an edge.
- `getPropertyValue(key)` &mdash; Reads a property exposed by the underlying data source.
- `setData(data)` / `setDataProperty(key, value)` &mdash; Update the node-specific data payload.
- `setState(state)` / `getState()` &mdash; Update or read the logical state (e.g. `hover`, `selected`).
- `isSelectable()` &mdash; Whether the runtime may select the node.
- `shouldHighlightConnectedEdges()` &mdash; Whether connected edges should be highlighted.

## EdgeInterface

Edges returned by `getEdges()` implement the following methods:

- `getId()` &mdash; Returns the edge identifier supplied by the data source.
- `isDirected()` &mdash; Indicates whether the edge direction should be considered.
- `getSourceNodeId()` / `getTargetNodeId()` &mdash; Node identifiers referenced by the edge.
- `getConnectedNodes()` &mdash; Returns the nodes that the edge currently references.
- `addNode(node)` / `removeNode(node)` &mdash; Mutate the set of connected nodes.
- `getPropertyValue(key)` &mdash; Reads a property exposed by the underlying data source.
- `setData(data)` / `setDataProperty(key, value)` &mdash; Update the edge-specific data payload.
- `setState(state)` / `getState()` &mdash; Update or read the logical state (e.g. `hover`, `selected`).

Refer to the [`TabularGraph`](./tabular-graph.md) and [`LegacyGraph`](./legacy-graph.md) reference
pages for implementation specific guidance.
