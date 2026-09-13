# Seasonal farm

A compact TreeLayer demo with seven labelled plots and 416 varied trees. Switch seasons
to change foliage, blossom, fruit, and bare branches. Hover a tree or plot to inspect it.
The farm starts fitted to the screen. Drag to pan, scroll or pinch to zoom, and
right-drag to tilt or rotate using the standard MapController. No basemap is required.

## Run

From the repository root:

```sh
yarn
yarn --cwd examples/three/wild-forest start
```

TreeLayer loads from source. The same demo runs standalone, on the website, and in the
gallery. Switching graphics backends preserves the camera and season.

## Data

The farm is a procedural illustration, not a real planting or agricultural guide. Its
seven species demonstrate all five TreeLayer silhouettes with varied ages, dimensions,
foliage, and crop loads. Seasons are illustrative and fruit and flowers are enlarged.
Ornamental cherries show blossom only. The demo makes no map or data requests.
