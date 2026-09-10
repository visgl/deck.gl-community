# Wild Forest

A TreeLayer explorer with seven regional groves of 400 trees each, starting in Siwa's
date-palm grove. Trees vary in age, size, shape, foliage, and crop load.

Choose a region to fly to its grove and a local season to update foliage, fruit, and
flowers. Drag, scroll, pinch, or use +/− to explore and interrupt flights. With reduced
motion enabled, region changes are immediate. Hover a tree to inspect its attributes.

## Run

From the repository root:

```sh
yarn
yarn --cwd examples/three/wild-forest start
```

TreeLayer loads from source without a package build. The same mount function powers the
standalone demo, documentation, and gallery. Switching graphics backends preserves the
camera, region, and season.

## Data and display scale

Regional examples in `forest-data.ts` include Siwa date palms, São Paulo oranges, Kyoto
ornamental cherries, Finnish birch, Alentejo cork oak, Riverland almonds, and Yosemite
pine. Each region links to a source. Tree locations and traits are procedural examples,
not surveyed inventories or a complete species distribution.

Trees retain metre-scale dimensions at every zoom. Seasons illustrate local conditions
rather than a single date across both hemispheres. Fruit and flowers are enlarged for
visibility; ornamental cherry shows blossom, not an edible-cherry harvest.

The CARTO / OpenStreetMap vector basemap requires network access. No API key or location
permission is needed. A retry action appears if map tiles fail to load.
