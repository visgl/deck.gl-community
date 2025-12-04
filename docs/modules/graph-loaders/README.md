# Overview

Graph loaders provide shared utilities for reading graph data into the formats expected by deck.gl community packages such as `@deck.gl-community/graph-layers`.

:::danger
The deck.gl-community repo is specifically set up to collect useful code that no longer has dedicated maintainers. This means that there is often no one who can respond quickly to issues. The vis.gl / Open Visualization team members who try to keep this running can only put a few hours into it every now and then. It is important to understand this limitation. If your project depends on timely fixes, and you are not able to contribute them yourself, deck.gl-community modules may not be the right choice for you.
:::

## Installation

```bash
npm install @deck.gl-community/graph-loaders
```

## Getting started

This module currently ships a small set of types and helpers that normalize loader output into a consistent shape. Future loader implementations (for formats like DOT or JSON) will be built on top of these primitives.

```ts
import {normalizeGraphData} from '@deck.gl-community/graph-loaders';

const graph = normalizeGraphData({
  nodes: [{id: 'n1', label: 'Origin'}],
  edges: [{source: 'n1', target: 'n2'}]
});
```

`normalizeGraphData` returns a `GraphLoaderResult` that always includes node and edge arrays, making it easier to plug into visualization layers.
