# Rank-Aligned DAG Layout

Deterministic utilities for building rank-aligned DAG layouts with [`d3-dag`](https://github.com/erikbrinkman/d3-dag).

## `layoutDagAligned`

```ts
import {layoutDagAligned} from '@deck.gl-community/graph-layers';
```

Runs `d3-dag`'s Sugiyama pipeline while locking nodes that share the same `rank(node)` onto identical vertical layers.

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `rank` | `(node) => number` | _(required)_ | Maps each node to a discrete layer id. Nodes that return the same rank share the same `y`. |
| `yScale` | `(rank) => number` | `undefined` | Remaps the final `y` coordinate. Supply this when your ranks encode uneven steps (e.g. timestamps). |
| `layering` | `'simplex' \| 'longestPath' \| 'topological'` | `'simplex'` | Sugiyama layering operator. |
| `decross` | `'twoLayer' \| 'greedy' \| 'opt'` | `'twoLayer'` | Decrossing operator. |
| `coord` | `'simplex' \| 'greedy' \| 'quad'` | `'simplex'` | Coordinate assignment operator. |
| `gap` | `[number, number]` | `[24, 40]` | Gap between nodes in the Sugiyama layout. |
| `nodeSize` | `(node) => [number, number]` | `undefined` | Optional per-node size accessor passed to Sugiyama. |
| `debug` | `boolean` | `false` | Emits verbose logging from the layout helper. |

### Notes

- `rank(node)` **must** increase monotonically along every directed edge. Bucket timestamps or other continuous values before passing them to the layout.
- When supplying `yScale`, ensure it returns deterministic values for the same rank so the layout stays stable.

The helper returns positioned nodes, untouched links, and the layout bounds:

```ts
const {nodes, links, width, height} = layoutDagAligned(nodes, links, {
  rank: (node) => node.step,
  yScale: (rank) => rank * 120
});
```

## Graph Layers Adapter

`@deck.gl-community/graph-layers` ships a `DagAlignedLayout` class that wraps this helper and exposes it through the standard `GraphLayout` interface.

```ts
import {GraphEngine, DagAlignedLayout} from '@deck.gl-community/graph-layers';

const layout = new DagAlignedLayout({
  rank: (node) => node.getPropertyValue('step') as number,
  yScale: (rank) => rank * 60
});

const engine = new GraphEngine({graph, layout});
engine.run();
```

Use `yScale` to align graph branches across uneven time buckets while still benefiting from Sugiyama's horizontal spacing heuristics.
