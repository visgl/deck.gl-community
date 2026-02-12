## RadialLayout (Experimental)

> Experimental layouts may change between releases. They are provided to showcase
> alternative ways of arranging dense graphs.

`RadialLayout` arranges vertices on concentric circles derived from a hierarchy. Nodes near the root are closer to the centre while leaves radiate towards the outer ring. The layout can optionally route edges through intermediate ancestors to reduce line crossings.

## Usage

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

### RadialLayoutProps

- `radius` (`number`, default `500`) - radius of the outer-most ring in screen units.
- `tree` (`Array<{id: string; children?: string[]}>`) - flattened hierarchical structure used to determine the placement of each node. Each entry represents a tree node with a unique `id` and an optional list of child node identifiers. The first element is treated as the root.
