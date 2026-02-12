# D3DagLayout

`D3DagLayout` wraps the [d3-dag](https://github.com/erikbrinkman/d3-dag) pipeline so you can generate layered layouts for directed graphs inside `GraphLayer`. It lets you pick from the built-in d3-dag operators or supply your own functions, and adds convenience utilities such as orientation transforms and chain collapsing to tame long linear stretches of nodes.

## Usage

```ts
import {D3DagLayout} from '@deck.gl-community/graph-layers';

const layout = new CollapsibleD3DagLayout({
  layout: 'sugiyama',
  layering: 'longestPath',
  decross: 'twoLayer',
  coord: 'greedy',
  nodeSize: [140, 80],
  orientation: 'LR',
  collapseLinearChains: true
});

new GraphLayer({
  id: 'graph',
  data: graphData,
  layout
});
```

## D3DagLayoutProps

- `collapseLinearChains` (`boolean`, default `false`) - Collapses chains of degree-one nodes into a single representative so long pipelines can be expanded or collapsed interactively. Collapsed chains expose metadata on each node (`collapsedChainId`, `collapsedNodeIds`, etc.) for UI controls.


## Runtime controls

- `setProps(options)` - Merges partial props and reruns the layout. Useful for live controls that tweak layering/decross operators without recreating the layout instance.
- `toggleCollapsedChain(chainId)` / `setCollapsedChains(chainIds)` - Toggle or set the collapse state for previously detected linear chains. Chain identifiers can be read from node data (`collapsedChainId`).
- `getLinkControlPoints(edge)` - Returns any intermediate control points computed by the active d3-dag operator, allowing `GraphLayer` edge renderers to draw smooth splines.

These helpers invoke the standard layout lifecycle callbacks (`onLayoutStart`, `onLayoutChange`, `onLayoutDone`) so the layer updates automatically when the DAG pipeline finishes.
