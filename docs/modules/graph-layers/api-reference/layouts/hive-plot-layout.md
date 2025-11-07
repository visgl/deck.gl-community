## HivePlotLayout (Experimental)

> Experimental layouts may change between releases. They are provided to showcase
> alternative ways of arranging dense graphs.

`HivePlotLayout` distributes nodes along evenly spaced axes. The layout groups nodes onto axes and sorts each axis by node degree so that highly connected nodes are pushed towards the outer radius. Connections between axes are drawn as curved splines to reduce clutter.

## Usage

A `getNodeAxis()` property lets the application specify which group each node belowngs to.

```tsx
import {HivePlotLayout} from '@deck.gl-community/graph-layers';

const layout = new HivePlotLayout({
  innerRadius: 80,
  outerRadius: 320,
  getNodeAxis: (node) => node.getPropertyValue('region')
});
```

## Types

## HivePlotLayoutProps

- `innerRadius` (`number`, default `100`) - radius of the innermost point where axes begin.
- `outerRadius` (`number`, default `500`) - radius of the outermost point where the last node on an axis is placed.
- `getNodeAxis` (`(node: Node) => string`, default `node.getPropertyValue('group')`) - accessor returning the axis key for a node. Nodes with the same key share an axis.
