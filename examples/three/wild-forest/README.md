# Wild Forest

A minimal TreeLayer explorer that opens in Siwa's date-palm grove. Seven regional
settings contain 400 varied trees each, covering all five procedural forms (palm, oak,
pine, birch, and cherry): 2,800 trees in total. Orchards use planted rows and working
lanes; woodland groves have irregular clusters and openings. Trees and grove spacing always use metre-scale dimensions.

Choose a region in the compact selector to fly to its centered grove. Region changes
use `FlyToInterpolator` with a 1-second animation; reduced-motion preferences apply
the destination immediately. The flight remains continuous through the globe/map
projection change. Drag, scroll, pinch, or press +/− to take control immediately.
The only appearance control is **Local season**; foliage, fruit, flowers, and bare
branches update together. Each tree has independent maturity, height, crown width,
trunk thickness and proportion, bark and foliage tones, branch tiers, vigor, seasonal
timing, crop load, and fruit size. Saplings do not carry crops; blossom, foliage fullness,
ripening, and fruit drop vary across mature trees. Hover a crown to inspect its simulated
attributes. Resizing the demo refits the selected grove.

## Run

From the repository root:

```sh
yarn
yarn --cwd examples/three/wild-forest start
```

The Vite configuration resolves TreeLayer from source without a package build. The same
mount function powers the documentation and gallery; their graphics backend switcher
preserves the camera and both selections. The demo explicitly pairs GlobeController with
a globe viewport and MapController with a local map viewport at the projection handoff.

## Data and display scale

The source-linked regional examples in `forest-data.ts` include Siwa date palms,
São Paulo oranges, Kyoto ornamental cherries, Finnish birch, Alentejo cork oak,
Riverland almonds, and Yosemite pine. These are representative locations and procedural
models, not surveyed individual trees, terrain data, or a complete species distribution.

Models retain their metre-scale dimensions even while flying between regions or
zooming out to the globe. Camera motion reuses resident tree and crop geometry, including across projection changes.
Distant groves are culled from drawing; fitted cameras and crown hit areas are cached.
Map tile requests wait for 200 ms of settled movement instead of fetching every intermediate
flight view. Each selected season
represents the local season of every sample; it is
not a single date occurring simultaneously in both hemispheres. Phenology is illustrative,
and fruit and flower markers are enlarged for visibility. Ornamental cherry shows blossom,
not an edible-cherry harvest.

The vector basemap uses CARTO / OpenStreetMap MVT tiles with muted land, water, roads,
and buildings. Source zoom 14 tiles are overzoomed for close inspection. Network access
is required; attribution and a map retry action remain available. No API key or location
permission is needed.
