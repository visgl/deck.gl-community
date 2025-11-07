# D3DagLayout

`D3DagLayout` wraps the [d3-dag](https://github.com/erikbrinkman/d3-dag) pipeline so you can generate layered layouts for directed graphs inside `GraphLayer`. It lets you pick from the built-in d3-dag operators or supply your own functions, and adds convenience utilities such as orientation transforms and chain collapsing to tame long linear stretches of nodes.

## Usage

```ts
import {D3DagLayout} from '@deck.gl-community/graph-layers';

const layout = new D3DagLayout({
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

### Pipeline operators

- `layout` (`'sugiyama' | 'grid' | 'zherebko' | (dag) => LayoutResult`, default `'sugiyama'`) - Chooses the high-level d3-dag operator. You can pass a layout instance returned from d3-dag directly to gain full control.
- `layering` (`'simplex' | 'longestPath' | 'topological' | function`, default `'topological'`) - Layering step used by sugiyama layouts. Supply a custom layering operator created with d3-dag helpers to override the defaults.
- `decross` (`'twoLayer' | 'opt' | 'dfs' | function`, default `'twoLayer'`) - Decrossing strategy used to reduce edge crossings in sugiyama layouts.
- `coord` (`'simplex' | 'greedy' | 'quad' | 'center' | 'topological' | function`, default `'greedy'`) - Coordinate assignment phase for sugiyama layouts.
- `nodeSize` (`[number, number] | NodeSize`, default `[140, 120]`) - Fixed size or accessor that reports each node's width and height to d3-dag.
- `gap` (`[number, number]`, default `[0, 0]`) - Gap between nodes in the x/y directions. `separation` is an alias.
- `separation` (`[number, number]`, default `[0, 0]`) - Preferred spacing between adjacent nodes; takes precedence over `gap` when both are provided.

When any of these options change, the layout pipeline is recomputed on the next tick.

### Graph preparation

- `dagBuilder` (`'graph' | 'connect' | 'stratify' | (graph) => MutGraph`, default `'graph'`) - Controls how the `Graph` is converted into a d3-dag instance. Use `'graph'` for direct node/edge translation, `'connect'` to infer structure from edge lists, or `'stratify'` when the graph already stores parent references. Pass a custom builder to plug in your own conversion step.

### Post-processing

- `orientation` (`'TB' | 'BT' | 'LR' | 'RL'`, default `'TB'`) - Rotates and flips the final coordinates. `'TB'` keeps the root at the top; `'LR'` produces a left-to-right layout, and so on.
- `center` (`boolean | {x?: boolean; y?: boolean}`, default `true`) - Centers the layout around the origin on the selected axes. Disable to keep the d3-dag output in its native coordinate space.

## Runtime controls

- `setProps(options)` - Merges partial props and reruns the layout. Useful for live controls that tweak layering/decross operators without recreating the layout instance.

These helpers emit the standard layout lifecycle events (`onLayoutStart`, `onLayoutChange`, `onLayoutDone`) so the layer updates automatically when the DAG pipeline finishes.
