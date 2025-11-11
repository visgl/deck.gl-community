---
title: DOT Format Overview
sidebar_label: DOT Format Overview
description: Summary of the Graphviz DOT language and how it maps into graph-layers.
---

The Graphviz [DOT language](https://graphviz.org/doc/info/lang.html) describes graphs using a concise text syntax. DOT remains a de facto interchange format across graph analytics tooling, making it a natural bridge into the `@deck.gl-community/graph-layers` ecosystem.

## Building blocks

DOT files describe:

- **Graph statements** – `graph` (undirected) or `digraph` (directed), optionally prefixed with `strict` to disallow parallel edges. Graph-level attributes appear either in `graph [...]` blocks or as `key=value;` assignments.
- **Nodes** – Declared explicitly (`node1 [label="Label"];`) or implicitly when referenced by an edge. Node attributes are key/value pairs, and `node [...]` statements set defaults for subsequent nodes within the current scope.
- **Edges** – Connect nodes using `--` (undirected) or `->` (directed). Edge chains such as `a -> b -> c` expand to multiple edges. Attribute defaults come from `edge [...]` statements, while individual edges can override them.
- **Subgraphs** – `subgraph` blocks (including the `cluster_*` convention used by Graphviz) group nodes for styling or layout hints. Nested subgraphs form a hierarchy.

## How graph-layers interprets DOT

The DOT loader shipped with graph-layers preserves the majority of authoring intent:

- Graph-level attributes populate loader metadata so applications can inspect labels, layout hints, or custom properties.
- Nodes and edges retain all declared attributes in their respective `data` bags, including numeric weights, labels, and styles.
- Scoped `node [...]` and `edge [...]` defaults cascade through nested subgraphs, matching Graphviz semantics.
- Subgraph membership becomes an explicit `subgraphs` array on every node and edge, recording the subgraph identifier, its attributes, and the parent relationship.
- Directionality derives from the edge operator and honors the `dir=none` override that Graphviz uses to suppress arrowheads inside directed graphs.

## Additional resources

- [DOT Language Reference](https://graphviz.org/doc/info/lang.html) – Official specification maintained by the Graphviz project.
- [Graphviz Gallery](https://graphviz.org/gallery/) – Examples showcasing DOT syntax for clusters, network diagrams, and more.
- [Graphviz FAQ](https://graphviz.org/faq/) – Answers to common modeling questions and tips for working with DOT.

Understanding how DOT encodes structural and styling information helps when mapping existing Graphviz assets into GPU-driven visualizations built with graph-layers.
