# Seasonal Farm

A compact TreeLayer demo with seven plots and 416 varied trees. It is the live example on the
TreeLayer docs page. Hover a tree or plot to inspect it.

The **TreeLayer** panel maps directly onto layer props:

- **Trees**: season (`getSeason`), fruit and flowers (`getCrop`), wind (`windStrength`) and size
  (`sizeScale`).
- **Crown**: every shared `characteristics` field, from seed and spread to leaf density.
- **Rendering**: the shared splat budget (`maxCanopySplats`), canopy pixel cap
  (`maxCanopyPixels`) and foveation strength.

Drag to pan, scroll or pinch to zoom, and right-drag to tilt or rotate, up to zoom 23 and an 80°
pitch. No basemap is required.

## Run

From the repository root:

```sh
yarn
yarn --cwd examples/layers/seasonal-farm start
```

TreeLayer loads from source. The same demo runs standalone, on the website, and in the
gallery. Switching graphics backends preserves the camera and panel settings.

## Data

The farm is a procedural illustration, not a real planting or agricultural guide. Ages,
dimensions, foliage and crop loads vary per tree. Seasons are illustrative, and fruit, flowers
and acorns are close to life size. Ornamental cherries show blossom only. The demo makes no map
or data requests.
