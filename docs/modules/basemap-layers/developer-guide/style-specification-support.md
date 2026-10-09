# Style Specification Support

`BasemapLayer` implements a subset of the [MapLibre Style Specification][spec]. This page lists
the parts of the specification and what the module currently does with each. Properties that are
not listed are not supported. Follow-up changes update the table as gaps close.

| Status        | Meaning                                                                            |
| ------------- | ---------------------------------------------------------------------------------- |
| Supported     | Implemented as the specification describes, apart from the notes.                  |
| Partial       | Implemented with a documented approximation, or for some of the values.            |
| Not supported | Ignored, so a style that uses it renders without it, unless a note says otherwise. |

## Layer types

See [Layers][layers]. Layers of an unsupported type are skipped.

| Layer type       | Status        | Notes                                                                                                                                                                |
| ---------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `background`     | Partial       | `background-color` and `background-opacity`. Without `background-color` the background is transparent, not the default black. `background-pattern` is not supported. |
| `fill`           | Partial       | `fill-pattern` and `fill-translate` are not supported. See [Paint properties](#paint-properties).                                                                    |
| `line`           | Partial       | See [Paint properties](#paint-properties) and [Layout properties](#layout-properties).                                                                               |
| `symbol`         | Partial       | Text and icons at anchor points: one per point, line and polygon. See [Symbols](#symbols).                                                                           |
| `fill-extrusion` | Partial       | Patterns, translation and the style's `light` are not supported. See [Paint properties](#paint-properties).                                                          |
| `raster`         | Partial       | Tiles are drawn; `raster-*` paint properties are not applied.                                                                                                        |
| `circle`         | Not supported |                                                                                                                                                                      |
| `heatmap`        | Not supported |                                                                                                                                                                      |
| `hillshade`      | Not supported |                                                                                                                                                                      |
| `color-relief`   | Not supported |                                                                                                                                                                      |

## Sources

See [Sources][sources].

| Source type  | Status        | Notes                                                                                                                                                |
| ------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vector`     | Partial       | Inline `tiles`, or a TileJSON `url`. `scheme: "tms"` and `bounds` are not applied. If the TileJSON cannot be fetched, the whole style fails to load. |
| `raster`     | Partial       | Inline `tiles`, or a TileJSON `url`. `scheme: "tms"` and `bounds` are not applied. If the TileJSON cannot be fetched, the whole style fails to load. |
| `raster-dem` | Not supported |                                                                                                                                                      |
| `geojson`    | Not supported | Layers that use a GeoJSON source are skipped.                                                                                                        |
| `image`      | Not supported | The style fails to load: the image's `url` is fetched as TileJSON.                                                                                   |
| `video`      | Not supported |                                                                                                                                                      |

## Expressions and filters

See [Expressions][expressions].

| Feature                         | Status        | Notes                                                                                           |
| ------------------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| Constant and data-driven values | Supported     | Evaluated with `@maplibre/maplibre-gl-style-spec`, per feature where the property allows it.    |
| Zoom-dependent values           | Partial       | Evaluated at the zoom rounded down to a 0.25 step, not interpolated continuously.               |
| `feature-state`                 | Not supported | Feature state is always empty.                                                                  |
| `filter`                        | Supported     | Evaluated per feature. `["zoom"]` in a filter uses the integer zoom, as the specification says. |
| Legacy `ref` layers             | Supported     | Resolved when the style loads.                                                                  |

## Layer visibility and zoom range

| Feature                        | Status        | Notes                                                 |
| ------------------------------ | ------------- | ----------------------------------------------------- |
| `minzoom` / `maxzoom`          | Supported     | Compared with the exact zoom.                         |
| Overzoom past source `maxzoom` | Supported     | The deepest tiles are scaled up; layers keep drawing. |
| `layout.visibility`            | Not supported | A layer with `visibility: "none"` is still drawn.     |

## Paint properties

See [Layers][layers] for the properties of each type.

| Property                                                     | Status        | Notes                                                                                                                      |
| ------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `fill-color`, `fill-opacity`                                 | Partial       | Per feature. Without `fill-color`, fills are transparent instead of the default black. On a globe, fills are drawn opaque. |
| `fill-outline-color`                                         | Partial       | A 1 CSS pixel outline; MapLibre's is one device pixel. Not drawn when `fill-antialias` is `false`.                         |
| `fill-pattern`, `fill-translate`                             | Not supported |                                                                                                                            |
| `line-color`, `line-opacity`, `line-width`                   | Supported     | Per feature.                                                                                                               |
| `line-dasharray`                                             | Partial       | One dash and one gap per period; longer patterns merge their dashes. Switches at integer zooms instead of cross-fading.    |
| `line-offset`, `line-gap-width`, `line-blur`                 | Not supported |                                                                                                                            |
| `line-gradient`, `line-pattern`, `line-translate`            | Not supported |                                                                                                                            |
| `fill-extrusion-color`, `-height`, `-base`                   | Supported     | Per feature, heights in meters. The alpha of the color is ignored, as in MapLibre.                                         |
| `fill-extrusion-opacity`                                     | Partial       | Applied to each surface, so walls behind a building can show through.                                                      |
| `fill-extrusion-pattern`, `-translate`, `-vertical-gradient` | Not supported | Extrusions use deck.gl's default lighting, not the style's `light`.                                                        |
| `raster-*`                                                   | Not supported | `raster-opacity`, `raster-fade-duration` and the color adjustments are not applied.                                        |

## Layout properties

| Property                       | Status                  | Notes                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `line-cap`, `line-join`        | Not supported           | Lines always have round caps and joins.                                                                                                                                                                                                                                                                                                                |
| `symbol-*`, `text-*`, `icon-*` | See [Symbols](#symbols) |                                                                                                                                                                                                                                                                                                                                                        |
| Other properties               | Not supported           | For example `line-sort-key`, `fill-sort-key`, `line-miter-limit`, `line-round-limit`, `text-keep-upright`, `text-max-angle`, `text-radial-offset`, `text-writing-mode`, `symbol-spacing`, `symbol-avoid-edges`, `symbol-z-order`, the `*-translate`, `*-pitch-alignment` and `*-rotation-alignment` properties, `icon-halo-*` and `raster-resampling`. |

## Symbols

| Feature                                                                     | Status        | Notes                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `symbol-placement: point`                                                   | Partial       | Points are labelled at the point, and each polygon at its pole of inaccessibility, as in MapLibre. Line features are labelled at the middle vertex of their first part. A polygon in two tiles' buffers is labelled by the tile that holds its pole. Polygon label search is bounded per tile; on a tile with unusually heavy polygon geometry, the remaining polygons are not labelled. |
| `symbol-placement: line` / `line-center`                                    | Partial       | Line features get one upright label at the middle vertex of their first part. Labels do not follow the line. Polygon features are not labelled.                                                                                                                                                                                                                                          |
| `text-field`                                                                | Supported     | Expressions and legacy `{token}` strings.                                                                                                                                                                                                                                                                                                                                                |
| `text-color`, `text-opacity`                                                | Supported     | Per feature.                                                                                                                                                                                                                                                                                                                                                                             |
| `text-size`                                                                 | Partial       | Per feature. Without `text-size`, labels are 14 px instead of the default 16 px, and a size of 0 draws 14 px text instead of hiding the label.                                                                                                                                                                                                                                           |
| `text-offset`, `text-anchor`                                                | Supported     | Per feature.                                                                                                                                                                                                                                                                                                                                                                             |
| `text-font`                                                                 | Partial       | Mapped to a CSS font family list, weight and style; no glyphs are loaded. One font per style layer and zoom step. See [Label fonts](/docs/modules/basemap-layers#label-fonts).                                                                                                                                                                                                           |
| `text-halo-color`                                                           | Partial       | Drawn as a background box behind the text, not as a halo around the glyphs. Evaluated once per style layer and zoom step, not per feature, and drawn even when `text-halo-width` is 0.                                                                                                                                                                                                   |
| `text-halo-width`, `text-halo-blur`                                         | Not supported |                                                                                                                                                                                                                                                                                                                                                                                          |
| `text-justify`, `text-max-width`, `text-line-height`, `text-letter-spacing` | Not supported | Text is not wrapped. Line breaks (`\n`) in `text-field` are kept, with a line height of 1.0 rather than the default 1.2.                                                                                                                                                                                                                                                                 |
| `text-rotate`, `text-transform`, `text-variable-anchor`, `text-padding`     | Not supported |                                                                                                                                                                                                                                                                                                                                                                                          |
| `symbol-sort-key`                                                           | Supported     | Orders labels within a style layer. Later symbol layers in the style take priority over earlier ones. Without a sort key, labels are ranked by a built-in heuristic on OpenMapTiles fields (`capital`, `class`, water names), which MapLibre does not do.                                                                                                                                |
| Label collision                                                             | Partial       | Labels are hidden where they collide, using deck.gl's `CollisionFilterExtension`, which tests an area around each label's anchor rather than its full box.                                                                                                                                                                                                                               |
| `text-allow-overlap`, `text-ignore-placement`, `text-optional`              | Not supported |                                                                                                                                                                                                                                                                                                                                                                                          |
| `icon-image`                                                                | Supported     | Expressions and legacy `{token}` names, from the style's sprites.                                                                                                                                                                                                                                                                                                                        |
| `icon-size`, `icon-opacity`, `icon-anchor`, `icon-offset`                   | Supported     | Per feature.                                                                                                                                                                                                                                                                                                                                                                             |
| `icon-color`                                                                | Supported     | For SDF images.                                                                                                                                                                                                                                                                                                                                                                          |
| Icon collision                                                              | Not supported | Every icon is drawn; icons and their labels are not placed as one unit.                                                                                                                                                                                                                                                                                                                  |
| `icon-rotate`, `icon-text-fit`, `icon-padding`, `icon-allow-overlap`        | Not supported |                                                                                                                                                                                                                                                                                                                                                                                          |

## Style resources

| Feature                            | Status        | Notes                                                                                                                            |
| ---------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [`sprite`][sprite]                 | Supported     | A single URL or the array form. `@2x` is requested first when the device pixel ratio is 2 or more. URLs may carry query strings. |
| [`glyphs`][glyphs]                 | Not supported | Labels use browser fonts (see `text-font`).                                                                                      |
| [`light`][light]                   | Not supported |                                                                                                                                  |
| [`sky`][sky], [`terrain`][terrain] | Not supported |                                                                                                                                  |
| [`projection`][projection]         | Not supported | Use deck.gl's `MapView` or `GlobeView`, with the `mode` prop.                                                                    |

## Rendering

| Feature    | Status  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draw order | Partial | Background layers draw first, then each vector source with its style layers in style order, then raster layers. Layers from different sources are not interleaved, so a style that alternates sources can draw in a different order than MapLibre. Each tile draws all of its layers before the next tile, so layers are not interleaved across tiles either. A flat layer that comes after a `fill-extrusion` layer is hidden behind the buildings. |
| Globe view | Partial | `mode: 'globe'` draws on deck.gl's `GlobeView`, with an optional atmosphere (see the [`globe`](/docs/modules/basemap-layers/api-reference/basemap-layer#globe) prop). Labels on the far side of the globe are not hidden.                                                                                                                                                                                                                            |

[spec]: https://maplibre.org/maplibre-style-spec/
[layers]: https://maplibre.org/maplibre-style-spec/layers/
[sources]: https://maplibre.org/maplibre-style-spec/sources/
[expressions]: https://maplibre.org/maplibre-style-spec/expressions/
[sprite]: https://maplibre.org/maplibre-style-spec/sprite/
[glyphs]: https://maplibre.org/maplibre-style-spec/glyphs/
[light]: https://maplibre.org/maplibre-style-spec/light/
[sky]: https://maplibre.org/maplibre-style-spec/sky/
[terrain]: https://maplibre.org/maplibre-style-spec/terrain/
[projection]: https://maplibre.org/maplibre-style-spec/projection/
