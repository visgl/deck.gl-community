# Experimental Layouts

`@deck.gl-community/graph-layers` ships a set of experimental layouts that extend the base `GraphLayout` API. These layouts are
ported from the archived [graph.gl](https://graph.gl) project and remain under active development. They are exported from the
package as `CosmosLayout`, `RadialLayout`, `HivePlotLayout`, and `ForceMultiGraphLayout`.

> **Note**
> Experimental layouts may change between releases. They are provided to unblock migration work from graph.gl and to showcase
> alternative ways of arranging dense graphs.

## CosmosLayout

`CosmosLayout` adapts the [cosmos.gl](https://cosmos.gl/) GPU simulation so it can be consumed through the standard `GraphLayout`
interface. The adapter keeps the deck.gl graph in sync with the Cosmos controller, firing layout lifecycle events as the GPU
simulation starts, ticks, and cools.

> Install `cosmos.gl` alongside `@deck.gl-community/graph-layers` to use this adapter:
>
> ```bash
> yarn add cosmos.gl
> ```

### Options

- `cosmos` (`Record<string, unknown>`, default `{}`) – configuration object forwarded to `createCosmosLayout` from `cosmos.gl`.
  Refer to the Cosmos documentation for supported knobs such as `cooldownTicks`, `springLength`, `repulsion`, and `gravity`.

```tsx
import {CosmosLayout} from '@deck.gl-community/graph-layers';

const layout = new CosmosLayout({
  cosmos: {
    cooldownTicks: 240,
    repulsion: 0.35,
    springLength: 160
  }
});
```

## RadialLayout

`RadialLayout` arranges vertices on concentric circles derived from a hierarchy. Nodes near the root are closer to the
centre while leaves radiate towards the outer ring. The layout can optionally route edges through intermediate ancestors to
reduce line crossings.

### Options

- `radius` (`number`, default `500`) – radius of the outer-most ring in screen units.
- `tree` (`Array<{id: string; children?: string[]}>`) – flattened hierarchical structure used to determine the placement of
  each node. Each entry represents a tree node with a unique `id` and an optional list of child node identifiers. The first
  element is treated as the root.

```tsx
import {RadialLayout} from '@deck.gl-community/graph-layers';

const layout = new RadialLayout({
  radius: 480,
  tree: [
    {id: 'root', children: ['group-a', 'group-b']},
    {id: 'group-a', children: ['node-1', 'node-2']},
    {id: 'group-b', children: ['node-3']}
  ]
});
```

## HivePlotLayout

`HivePlotLayout` distributes nodes along evenly spaced axes. A configurable accessor groups nodes onto axes and sorts each
axis by node degree so that highly connected nodes are pushed towards the outer radius. Connections between axes are drawn as
curved splines to reduce clutter.

### Options

- `innerRadius` (`number`, default `100`) – radius of the innermost point where axes begin.
- `outerRadius` (`number`, default `500`) – radius of the outermost point where the last node on an axis is placed.
- `getNodeAxis` (`(node: Node) => string`, default `node.getPropertyValue('group')`) – accessor returning the axis key for a
  node. Nodes with the same key share an axis.

```tsx
import {HivePlotLayout} from '@deck.gl-community/graph-layers';

const layout = new HivePlotLayout({
  innerRadius: 80,
  outerRadius: 320,
  getNodeAxis: (node) => node.getPropertyValue('region')
});
```

## ForceMultiGraphLayout

`ForceMultiGraphLayout` is a force-directed simulation tailored for graphs that contain multiple edges between the same
source and target. The layout introduces virtual edges to spread parallel connections apart and exposes tuning knobs for the
underlying D3 force simulation.

### Options

- `alpha` (`number`, default `3`) – initial alpha value passed to the force simulation. Higher values take longer to cool down
  but can escape deep local minima.
- `nBodyStrength` (`number`, default `-1200`) – strength of the repulsive many-body force between nodes.
- `nBodyDistanceMin` (`number`, default `100`) – minimum distance threshold used by the many-body force.
- `nBodyDistanceMax` (`number`, default `1400`) – maximum distance threshold used by the many-body force.

```tsx
import {ForceMultiGraphLayout} from '@deck.gl-community/graph-layers';

const layout = new ForceMultiGraphLayout({
  alpha: 2.5,
  nBodyStrength: -6000,
  nBodyDistanceMin: 60,
  nBodyDistanceMax: 1200
});
```

Each layout implements the `GraphLayout` interface, so they can be swapped into `GraphLayer` or `GraphEngine` instances just
like the built-in force and simple layouts.
