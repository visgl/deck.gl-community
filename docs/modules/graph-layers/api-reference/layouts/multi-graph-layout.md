## ForceMultiGraphLayout (Experimental)

> Experimental layouts may change between releases. They are provided to showcase
> alternative ways of arranging dense graphs.

`ForceMultiGraphLayout` is a force-directed simulation tailored for graphs that contain multiple edges between the same source and target. The layout introduces virtual edges to spread parallel connections apart and exposes tuning knobs for the underlying D3 force simulation.

## Usage

```tsx
import {ForceMultiGraphLayout} from '@deck.gl-community/graph-layers';

const layout = new ForceMultiGraphLayout({
  alpha: 2.5,
  nBodyStrength: -6000,
  nBodyDistanceMin: 60,
  nBodyDistanceMax: 1200
});
```

## ForceMultiGraphLayoutProps

- `alpha` (`number`, default `3`) - initial alpha value passed to the force simulation. Higher values take longer to cool down
  but can escape deep local minima.
- `nBodyStrength` (`number`, default `-1200`) - strength of the repulsive many-body force between nodes.
- `nBodyDistanceMin` (`number`, default `100`) - minimum distance threshold used by the many-body force.
- `nBodyDistanceMax` (`number`, default `1400`) - maximum distance threshold used by the many-body force.
