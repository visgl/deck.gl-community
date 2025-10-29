# graph-layers

TBD

## D3 DAG Layout

`@deck.gl-community/graph-layers` now ships with a declarative wrapper around [`d3-dag`](https://github.com/erikbrinkman/d3-dag) so that directed acyclic graphs can be positioned with the classic Sugiyama pipeline. The layout enforces directed edges: undirected edges are rejected up-front and cyclic graphs cause the layout to emit `onLayoutError`, which allows the host application to surface meaningful error messages.

```ts
import {GraphLayer, D3DagLayout} from '@deck.gl-community/graph-layers';

const dagLayout = new D3DagLayout({
  nodeSize: [120, 48],
  layering: 'longest-path',
  decross: 'opt',
  coord: 'greedy'
});

dagLayout.addEventListener('onLayoutError', () => {
  console.warn('Input graph must be directed and acyclic.');
});

const layer = new GraphLayer({
  id: 'dag-layer',
  graph,
  layout: dagLayout,
  ...layerProps
});
```

All three stages of the Sugiyama algorithm are configurable. Supply a preset string (`'longest-path'`, `'simplex'`, `'topological'`, `'coffman-graham'` for layering; `'two-layer'` or `'opt'` for decross; `'center'`, `'greedy'`, or `'quad'` for coordinate assignment) or pass the corresponding operator returned by `d3-dag` directly. The layout caches per-node coordinates and the polyline control points returned for each link so `getEdgePosition` can expose detailed path metadata to deck.gl edge layers.

<p align="center">
  <img src="https://i.imgur.com/BF9aOEu.png" height="400" />
</p>
