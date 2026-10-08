# What's New

## October 2026

- `line-width` is drawn as the style sets it: the OpenMapTiles-specific scaling (0.55 for `transportation`/`boundary`, 0.75 for `waterway`/`aeroway`) is removed, a width of 0 draws nothing, and wide lines are no longer capped at 20 px.
- Style evaluation uses `@maplibre/maplibre-gl-style-spec` instead of `@mapbox/mapbox-gl-style-spec`. Evaluated colors keep the same `[r, g, b, a]` shape (RGB 0-255, alpha 0-1).
- Style layers draw within their own `minzoom`/`maxzoom` only. A source's `maxzoom` no longer hides layers past it; its last tiles are overzoomed instead.
- Zoom-dependent style values are evaluated in 0.25 zoom steps instead of at integer zooms, so widths and colors no longer jump a whole zoom level at a time. Tiles regenerate at each step. Filtered features are kept per tile and style layer and reused across steps; they are recomputed only when a filter reading `["zoom"]` crosses an integer zoom, so other steps do not re-tessellate. Label paint is evaluated once per style layer and step.

## April 2026

- Renamed the runtime package surface to `@deck.gl-community/basemap-layers`
- Added a public `BasemapLayer` composite layer
- Added style-resolution helpers for style URLs, in-memory styles, and TileJSON-backed sources
- Added globe-oriented basemap helper exports and example usage
- Updated module documentation to describe the current runtime and map-style APIs

## December 2020

Work started on the basemap-layer module by collecting a number of related efforts into an open source module.
