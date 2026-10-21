# What's New

## October 2026

- Labels are drawn with the style's `glyphs`, as in MapLibre GL JS: the signed distance fields of each `text-font` stack, loaded per range as tiles need them, with MapLibre's advances and glyph placement. A tile's labels are placed once their glyphs have loaded. Styles without `glyphs`, and the `fontFamily` prop, still draw with the browser's fonts.
- Point labels place by `text-variable-anchor` and `text-variable-anchor-offset`, as MapLibre GL JS does: each label tries its anchors in order and is drawn at the first where it collides with nothing, instead of being dropped, with its icon left at the point. `text-radial-offset` offsets the text from the point in the anchor's direction, also with a fixed `text-anchor`, and `text-justify: auto` follows the anchor the label is placed at.
- `hillshade` layers over `raster-dem` sources are drawn, in style order, as MapLibre GL JS 6.13 draws them: `mapbox`, `terrarium` and `custom` encodings, a TileJSON `url` or inline `tiles`, every `hillshade-method` (`standard`, `basic`, `combined`, `igor`, `multidirectional` with up to four lights), `hillshade-illumination-direction`, `-altitude`, `-anchor`, `-exaggeration`, `-shadow-color`, `-highlight-color`, `-accent-color` and `resampling`. Tiles take their neighbors' edge pixels, so they join without seams. A source's tiles are fetched and decoded once, and shared by all of its `hillshade` layers, also through a switch between a map and a globe; direct `getBasemapLayers` callers can keep them across calls with `createDemTileset`. Also on a globe; WebGL only (WebGPU draws no hillshade).
- Style layers of a `geojson` source draw, cut into tiles on the client by `@maplibre/geojson-vt`, as MapLibre GL JS cuts them, in a web worker (on the main thread where none can start), and then drawn as vector tiles: `fill`, `line`, `circle`, `symbol` and `fill-extrusion` layers, on a map and on a globe. `data` is a GeoJSON object or a URL, fetched when the style resolves (relative to the style URL, with the `fetch` and `fetchOptions` of `loadOptions`). `maxzoom`, `buffer`, `tolerance`, `generateId`, `promoteId` and clustering (`cluster`, `clusterRadius`, `clusterMaxZoom`, `clusterMinPoints`) are supported; `clusterProperties`, `lineMetrics`, `filter` and `attribution` are not.
- Labels take their font from `text-font` instead of a fixed `Monaco, monospace`: each font name maps to a CSS family list with a generic fallback, plus a weight and style (`Noto Sans Bold` is `"Noto Sans", sans-serif` at weight 700). `BasemapLayer`'s new `fontFamily` prop overrides the family, or maps the font names with a function; `fontFamily: 'Monaco, monospace'` keeps the previous look.
- Symbol layers draw `icon-image` from the style's sprite (`@2x` on high-density screens, the `[{id, url}]` sprite array, `icon-size`, `icon-opacity`, `icon-anchor`, `icon-offset`, and `icon-color` for SDF images). Labels honor `text-offset` and `text-anchor`. Missing sprites and images are skipped with a warning.
- `line-width` is drawn as the style sets it: the OpenMapTiles-specific scaling (0.55 for `transportation`/`boundary`, 0.75 for `waterway`/`aeroway`) is removed, a width of 0 draws nothing, and wide lines are no longer capped at 20 px.
- Style evaluation uses `@maplibre/maplibre-gl-style-spec` instead of `@mapbox/mapbox-gl-style-spec`. Evaluated colors keep the same `[r, g, b, a]` shape (RGB 0-255, alpha 0-1).
- Style layers draw within their own `minzoom`/`maxzoom` only. A source's `maxzoom` no longer hides layers past it; its last tiles are overzoomed instead.
- Zoom-dependent style values are evaluated in 0.25 zoom steps instead of at integer zooms, so widths and colors no longer jump a whole zoom level at a time. Tiles regenerate at each step. Filtered features are kept per tile and style layer and reused across steps; they are recomputed only when a filter reading `["zoom"]` crosses an integer zoom, so other steps do not re-tessellate. Label paint is evaluated once per style layer and step.
- `line-sort-key` orders a line layer's features within a tile as MapLibre GL JS orders them, lowest key first: where lines cross, the one with the higher key draws on top, as on OSM Americana's roads, bridges and route lines. Dashed, offset and blurred lines are ordered too, also on a globe. Lines in different tiles are not ordered by key, and a `line-gap-width` draws one side of every line's gap before the other.

## April 2026

- Renamed the runtime package surface to `@deck.gl-community/basemap-layers`
- Added a public `BasemapLayer` composite layer
- Added style-resolution helpers for style URLs, in-memory styles, and TileJSON-backed sources
- Added globe-oriented basemap helper exports and example usage
- Updated module documentation to describe the current runtime and map-style APIs

## December 2020

Work started on the basemap-layer module by collecting a number of related efforts into an open source module.
