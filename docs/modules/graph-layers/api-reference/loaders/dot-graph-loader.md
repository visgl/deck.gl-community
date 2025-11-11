---
title: DOT Graph Loader
sidebar_label: DOT Graph Loader
description: Load Graphviz DOT files into the graph-layers data model.
---

The DOT graph loader converts Graphviz [DOT](https://graphviz.org/doc/info/lang.html) text into the `ArrowGraph` data structures consumed by the `@deck.gl-community/graph-layers` runtime. Use it when you need to visualize graphs described with Graphviz tooling while preserving node and edge attributes.

## Importing

```ts
import {
  loadDotGraph,
  parseDotToArrowGraphData
} from '@deck.gl-community/graph-layers';
```

## `loadDotGraph(dot: string, options?)`

Parses DOT text and returns an object containing:

- `graph` – a fully initialized `Graph` instance backed by `ArrowGraphData`.
- `data` – the normalized ArrowGraphData tables consumed by the runtime.
- `metadata` – graph level attributes such as the DOT graph identifier, strictness, default directionality, and declared subgraphs.

```ts
const dot = `digraph Example {
  graph [label="Example"];
  node [shape=circle];
  start -> finish [weight=3, label="flow"];
}`;

const {graph, metadata} = loadDotGraph(dot);

console.log(metadata.attributes.label); // "Example"
console.log(metadata.directed); // true

for (const edge of graph.getEdges()) {
  console.log(edge.getPropertyValue('label')); // "flow"
  console.log(edge.getPropertyValue('weight')); // 3
}
```

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `version` | `number` | `0` | Optional Arrow graph version recorded in the emitted `ArrowGraphData`. |

## `parseDotToArrowGraphData(dot: string, options?)`

Parses DOT text but only returns the `ArrowGraphData` tables plus loader metadata. Use this helper when you want to reuse the normalized tables without instantiating a `Graph` immediately.

```ts
const {data, metadata} = parseDotToArrowGraphData(dot);
// data.nodes and data.edges are Apache Arrow tables ready for serialization.
```

## Supported DOT features

- **Graph types** – `graph`, `digraph`, and `strict` graphs are recognized. Graph-level attributes set with `graph [...]` or `key=value` statements populate `metadata.attributes`.
- **Nodes** – Node declarations, implicit node creation through edges, and node attribute lists are mapped into the node data bag. The loader applies scoped `node [...]` default statements before merging explicit attributes.
- **Edges** – Edge chains (e.g. `a -> b -> c`) expand into individual edges. Each edge inherits scoped `edge [...]` defaults, attribute lists, and overrides direction using the edge operator (`->` or `--`). The DOT `dir=none` attribute forces undirected edges even inside a directed graph.
- **Subgraphs / clusters** – `subgraph` blocks record membership for every node and edge. The loader stores membership under the `subgraphs` property in the node/edge data bags, including the subgraph attributes and parent hierarchy.
- **Attribute types** – Numeric values are emitted as numbers; strings, including HTML-like labels, are preserved verbatim with common escape sequences (`\n`, `\l`, `\t`) translated.

## Known limitations

- Edge heads/tails with port or compass specifications (e.g. `node:port`) are treated as literal node identifiers.
- The loader ignores hyperlink attributes and DOT statements that reference graphs via the `subgraph -> subgraph` syntax.
- HTML labels are passed through as raw strings; downstream renderers must interpret them if needed.
- Global attribute defaults are merged per scope; they are not backfilled onto nodes or edges declared before the corresponding default statement.

These constraints keep the loader lightweight while covering the most common Graphviz authoring patterns. Contributions that expand the supported syntax are welcome.
