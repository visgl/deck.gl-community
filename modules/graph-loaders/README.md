# @deck.gl-community/graph-loaders

Graph data loaders and normalization utilities for [deck.gl](https://deck.gl).

:::danger
The deck.gl-community repo is specifically set up to collect useful code that no longer has dedicated maintainers. This means that there is often no one who can respond quickly to issues. The vis.gl / Open Visualization team members who try to keep this running can only put a few hours into it every now and then. It is important to understand this limitation. If your project depends on timely fixes, and you are not able to contribute them yourself, deck.gl-community modules may not be the right choice for you.
:::

## Installation

```bash
npm install @deck.gl-community/graph-loaders
```

## Usage

The initial release exposes a minimal set of types and helpers that are shared across graph loader implementations.

```ts
import {normalizeGraphData} from '@deck.gl-community/graph-loaders';

const graph = normalizeGraphData({
  nodes: [{id: 'a', label: 'Start'}],
  edges: [{source: 'a', target: 'b', relationship: 'leads-to'}]
});
```

## Status

This package is a scaffold for upcoming graph loader implementations (for example, DOT and JSON-based loaders). The shared helpers live here so that future loaders can publish a consistent `GraphLoaderResult` without relying on graph-layer internals.
