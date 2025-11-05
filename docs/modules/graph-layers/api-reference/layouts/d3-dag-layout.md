# D3DagLayout

`D3DagLayout` orchestrates [d3-dag](https://github.com/erikbrinkman/d3-dag) operators to render layered directed acyclic graphs
inside `@deck.gl-community/graph-layers`. It supports the standard Sugiyama pipeline as well as deterministic rank-based
alignment for workflow-style DAGs.

## Rank alignment

The `alignRank` option locks nodes that share the same discrete step onto a single vertical layer. Pass an accessor that maps
each `Node` to a numeric rank:

```tsx
import {D3DagLayout} from '@deck.gl-community/graph-layers';

const layout = new D3DagLayout({
  alignRank: (node) => Number(node.getPropertyValue('step'))
});
```

When enabled, the layout defaults to the following deterministic operators unless you override them:

- `layering: 'simplex'`
- `decross: 'twoLayer'`
- `coord: 'simplex'`
- `gap: [24, 40]`

### Non-uniform spacing with `alignScale`

Provide an optional `alignScale(rank)` function to stretch layers after the Sugiyama pass. This is useful when ranks represent
bucketed timestamps or milestones that are not evenly spaced:

```tsx
const timelineBuckets = {0: 0, 1: 6, 2: 18, 3: 24, 4: 44, 5: 56, 6: 70};

const layout = new D3DagLayout({
  alignRank: (node) => Number(node.getPropertyValue('step')),
  alignScale: (rank) => timelineBuckets[rank] ?? rank * 40
});
```

The scale only receives the rank value, so ensure every intermediate layer encountered by the DAG has a corresponding entry.
Long edges are expanded with dummy nodes so control points and splines respect the remapped distances.

### Best practices

- Ranks must remain discrete and monotonically increasing along every edge. Bucket real timestamps before passing them to
  `alignRank`.
- Combine `alignRank` with the interactive DAG graph viewer to compare multiple branches across shared steps. Toggle the
  `alignScale` function to switch between uniform spacing and timeline-aware spacing.

The rank alignment utilities are also exported independently as `layoutDagAligned`, `RankAccessor`, and `YScale` for use
outside of the layout class.
