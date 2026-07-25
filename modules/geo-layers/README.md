# @deck.gl-community/geo-layers

[![NPM Version](https://img.shields.io/npm/v/@deck.gl-community/geo-layers.svg)](https://www.npmjs.com/package/@deck.gl-community/geo-layers)
[![NPM Downloads](https://img.shields.io/npm/dw/@deck.gl-community/geo-layers.svg)](https://www.npmjs.com/package/@deck.gl-community/geo-layers)

This module contains a suite of non-official deck.gl layers.

They can be quite useful in applications, however they are not officially supported by the deck.gl team, so use at your own risk.

## Wind layers

The package includes the reusable layers and interpolation utilities from the historical deck.gl
wind showcase:

- `WindLayer` renders interpolated, speed-colored wind-direction arrows.
- `ParticleLayer` renders fading particle trails through the wind field.
- `ElevationLayer` renders the original elevation image as illuminated 3D mountain terrain.
- `DelaunayCoverLayer` renders elevation-colored station-triangulated terrain.
- `DelaunayInterpolation` samples or rasterizes the same field.
- `parseWindData`, `triangulateWindStations`, `createWindField`, and `sampleWindField` load and
  interpolate the original station-major, 72-hour weather forecast.

The standalone example is in `examples/geo-layers/wind`.
