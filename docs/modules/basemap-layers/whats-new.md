# What's New

## October 2026

- Style evaluation uses `@maplibre/maplibre-gl-style-spec` instead of `@mapbox/mapbox-gl-style-spec`. Evaluated colors keep the same `[r, g, b, a]` shape (RGB 0-255, alpha 0-1).
- Style layers draw within their own `minzoom`/`maxzoom` only. A source's `maxzoom` no longer hides layers past it; its last tiles are overzoomed instead.

## April 2026

- Renamed the runtime package surface to `@deck.gl-community/basemap-layers`
- Added a public `BasemapLayer` composite layer
- Added style-resolution helpers for style URLs, in-memory styles, and TileJSON-backed sources
- Added globe-oriented basemap helper exports and example usage
- Updated module documentation to describe the current runtime and map-style APIs

## December 2020

Work started on the basemap-layer module by collecting a number of related efforts into an open source module.
