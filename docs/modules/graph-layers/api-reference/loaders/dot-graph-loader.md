---
title: DOT Graph Loader
sidebar_label: DOT Graph Loader
description: Load Graphviz DOT files through loaders.gl.
---

![From v9.2](https://img.shields.io/badge/from-v9.2-green.svg?style=flat-square)

Use the published `@loaders.gl/graphs` package (4.5.3 or later) to parse DOT files.

```ts
import {load} from '@loaders.gl/core';
import {DOTLoaderWithParser} from '@loaders.gl/graphs/dot-loader';
import {ClassicGraph} from '@deck.gl-community/graph-layers';

const data = await load('network.dot', DOTLoaderWithParser);
const graph = new ClassicGraph({data});
```

For synchronous text parsing, call `DOTLoaderWithParser.parseTextSync(text)`.
The result contains plain `nodes`, `edges`, and DOT `metadata`, including graph attributes,
direction, strictness, and subgraph descriptors. IDs remain strings. Node and edge attributes
include scoped defaults and subgraph membership.

DOT syntax validation and strict-graph edge coalescing follow the upstream parser. See the
[loaders.gl graphs documentation](https://loaders.gl/docs/modules/graphs) for supported syntax
and limitations.
