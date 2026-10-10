# Overview

<p class="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
</p>

An implementation of a subset of the [Mapbox Style
Specification][mapbox_style_spec] using deck.gl layers and helpers.

_A work in progress_.

[mapbox_style_spec]: https://docs.mapbox.com/mapbox-gl-js/style-spec/

## Overview

The package is split into two surfaces:

- `@deck.gl-community/basemap-layers`
  Runtime helpers and the `BasemapLayer` `CompositeLayer`
- `@deck.gl-community/basemap-layers/map-style`
  Map-style parsing, validation, loading, and style-expression helpers

Exported runtime helpers:

- `BasemapLayer`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
- `getBasemapLayers`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
- `getGlobeBaseLayers`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
- `getGlobeTopLayers`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
- `resolveBasemapStyle`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />

Exported pure style helpers:

- `filterFeatures`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
- `findFeaturesStyledByLayer`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
- `parseProperties`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
- `resolveBasemapStyle`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
- `MapStyleLoader`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />
- `BasemapSourceSchema`, `BasemapStyleLayerSchema`, `BasemapStyleSchema`, `ResolvedBasemapStyleSchema`
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
  <img src="https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square" alt="experimental" />

The runtime surface is designed for backdrop basemaps and globe rendering, not for full replacement of a production basemap engine.

## Mapbox Style Spec Primer

The Mapbox Style Specification is a JSON document with two main parts, a `sources` object, and a `layers` array.

The `sources` object describes how to load each source. For example, a
"satellite streets" style might have two sources: one a raster source with
satellite imagery and the other a vector tile source with items to display on
top of the imagery. Such an object might look like:

```json
"sources": {
  "vector-source": {
    "type": "vector",
    "url": "https://example.com/tiles/vector-tiles.json"
  },
  "satellite-source": {
    "type": "raster",
    "url": "https://example.com/tiles/satellite-tiles.json"
  }
}
```

Here the keys `vector-source` and `satellite-source` describe each source that
can later be referenced from the `layers` object. Each `url` points to a
[TileJSON file][tilejson], which contains metadata describing how to load each
individual tile of the dataset.

[tilejson]: https://github.com/mapbox/tilejson-spec/blob/master/2.2.0/README.md

`layers` contains an array of objects, where each object defines an individual layer to render.

```json
"layers": [
  {
    "id": "satellite-layer",
    "type": "raster",
    "source": "satellite-source",
    "minzoom": 0,
    "maxzoom": 18,
    "paint": {"raster-opacity": 1}
  },
  {
    "id": "landuse_residential",
    "type": "fill",
    "source": "vector-source",
    "source-layer": "landuse",
    "maxzoom": 8,
    "filter": ["==", "class", "residential"],
    "paint": {
      "fill-color": {
        "base": 1,
        "stops": [
          [9, "hsla(0, 3%, 85%, 0.84)"],
          [12, "hsla(35, 57%, 88%, 0.49)"]
        ]
      }
    }
  },
  {
    "id": "waterway_river",
    "type": "line",
    "source": "vector-source",
    "source-layer": "waterway",
    "filter": ["all", ["==", "class", "river"], ["!=", "brunnel", "tunnel"]],
    "layout": {"line-cap": "round"},
    "paint": {
      "line-color": "#a0c8f0",
      "line-width": {"base": 1.2, "stops": [[11, 0.5], [20, 6]]}
    }
  }
]
```

The above describes a sequence of three layers. Later layers are rendered on top
of earlier layers, so this would show two vector layers on top of a satellite
layer.

Overview of each key:

- `id`: must be unique to each layer
- `type`: one of: `background`, `fill`, `line`, `symbol`, `raster`, `circle`, `fill-extrusion`, `heatmap`, `hillshade`, `sky` (v2 only).
- `source`: must be one of the keys defined in the initial `sources` object. So here each must be either `satellite-source` or `vector-source`.
- `source-layer`: For vector sources, each styling layer is rendered on only a single vector tile layer within the source. So when `source-layer` is `landuse`, the vector tiles provided by the `vector-source` source are expected to contain a layer named `landuse`, and this styling layer will apply only to that layer. This is required for vector sources.
- `minzoom`, `maxzoom`: zoom range in which the layer draws. Without them the layer draws at every zoom, as in MapLibre. The source's `minzoom`/`maxzoom` only limit which tiles are requested: past the source `maxzoom`, the last tiles are overzoomed.
- `filter`: A filter expression that is tested against every object within the vector tile layer.
- `layout`: A layout expression. These are less commonly used, and usually don't have a great equivalent in deck.gl.
- `paint`: Properties used for styling. Each layer type has a list of available paint properties. All properties except `visibility` are prefixed by the layer's type, hence `fill-color` and `line-width`. The value of each paint property can be either a constant value or color, or a styling expression that changes appearance based on zoom.

## Implementation Notes

Each supported style layer type is drawn with a deck.gl layer: `background` with a
`SolidPolygonLayer`, `fill`, `line` and `fill-extrusion` with a `GeoJsonLayer` per vector tile,
`symbol` with `TextLayer` and `IconLayer`, and `raster` with a `TileLayer` of `BitmapLayer`s.
See [Style Specification Support](/docs/modules/basemap-layers/developer-guide/style-specification-support)
for what is supported in each part of the specification.

The module evaluates styles with [`@maplibre/maplibre-gl-style-spec`][maplibre-style-spec-js], the standalone style-spec package from MapLibre GL JS. It:

- parses all permissible color descriptions into an rgba array
- Evaluates filter expressions for each GeoJSON `Feature` input
- Evaluates paint expressions given the zoom level

Zoom-dependent paint and layout values are evaluated at the zoom rounded down to a 0.25 step
(`STYLE_ZOOM_STEP`), and every visible tile uses the same evaluation zoom, so tiles agree at their
seams. Filters use the integer zoom, as the style spec specifies, and layer visibility uses the
exact zoom. MapLibre instead evaluates zoom expressions at the integer zooms on either side of
the current zoom and interpolates on the GPU; moving interpolation to the GPU remains the
long-term plan.

### Label fonts

Labels take their font from the symbol layer's `text-font`, or from the style spec's default
(`Open Sans Regular`, `Arial Unicode MS Regular`) when the layer does not set it. Each font name
is split into a family and its trailing weight and style words (`Thin`, `Light`, `Regular`,
`Medium`, `Semibold`, `Bold`, `ExtraBold`, `Black`, `Italic`, `Oblique`, and their variants), so
`["Open Sans Semibold Italic", "Arial Unicode MS Bold"]` becomes the CSS family list
`"Open Sans", "Arial Unicode MS", sans-serif` at weight 600, italic. The list ends with `serif` or
`monospace` when the first name says `Serif` or `Mono`, and `sans-serif` otherwise, so labels
still draw when none of the fonts is installed. No web fonts are loaded: the fonts must be
installed or loaded by the page.

`TextLayer` takes one font per layer, so the weight and style come from the first font of the
stack, and `text-font` is evaluated once per style layer and zoom step. A data-driven
`text-font` uses the value of the first label feature in each tile.

The [`fontFamily`](/docs/modules/basemap-layers/api-reference/basemap-layer#fontfamily) prop
overrides the mapping, with a fixed family list or a function from the font names to a family
list, weight and style. `getLabelFont(fontStack)` exposes the default mapping.

### Icons and sprites

When a style sets `sprite`, `BasemapLayer` loads the sprite's JSON index and image after the
style resolves, through the same `fetch` as the style and its tiles. The image is decoded once
and shared by every tile's icon layer. It requests the `@2x` sprite first
when the device pixel ratio is above 1, as MapLibre does, and falls back to `@1x`. A relative `sprite` URL resolves against the
style URL, and the array form (`[{id, url}]`) is supported: images from a sprite other than
`default` are named `id:name`.

Symbol layers with `icon-image` draw a deck.gl `IconLayer` per sprite under their labels.
`icon-image` accepts expressions and legacy `{token}` names; `icon-size`, `icon-opacity`,
`icon-anchor` and `icon-offset` are applied, and SDF images take `icon-color`. An image that no
sprite contains is skipped with one warning per name, and a sprite that fails to load is skipped
with a warning.

`text-offset` (in ems of `text-size`) and `text-anchor` position labels relative to their point.

Approximations:

- Icons are not collision-filtered: every icon whose style layer is visible is drawn, so dense
  icon layers can overlap. Labels keep their collision filtering. MapLibre places an icon and
  its text as one unit and hides both on collision.
- `icon-rotate`, `icon-text-fit`, `icon-padding` and `icon-allow-overlap` are not applied.

### Extrusions, dashes and fill outlines

`fill-extrusion` layers draw as extruded polygons (`GeoJsonLayer` with `extruded: true`).
`fill-extrusion-color`, `fill-extrusion-height` and `fill-extrusion-base` are evaluated per
feature; heights are in meters. The walls rise from the base, which is clamped to the height, so
a feature with a base draws as a block raised off the ground. `fill-extrusion-opacity` applies to
the whole layer, and the alpha of `fill-extrusion-color` is ignored, as in MapLibre. Extrusions are
depth-tested against each other, and flat layers are depth-tested against them without writing
depth, so flat layers keep drawing in style order but do not paint over a building from another
tile. In a flat view, the roofs draw.

`line-dasharray` dashes lines with deck.gl's `PathStyleExtension`. Lengths are in line widths, as
in MapLibre, and the pattern runs continuously along each line. Zoom-dependent patterns are
evaluated at integer zooms, as the style specification says.

`fill-outline-color` draws a 1 pixel outline around each polygon, multiplied by `fill-opacity`.
As in MapLibre, no outline is drawn when `fill-antialias` is `false`.

Approximations:

- Extrusions are lit by deck.gl's default lighting, not the style's `light`, and
  `fill-extrusion-vertical-gradient` is not applied. `fill-extrusion-pattern` is not supported.
- `fill-extrusion-opacity` scales each surface's opacity. MapLibre composites the layer as a
  whole, so with an opacity below 1 MapLibre hides the walls behind a building, which deck.gl can
  show.
- deck.gl draws one dash and one gap per period. A pattern longer than two values keeps its period
  and its total dash length, but its dashes merge into one. In an odd-length pattern the last
  dash runs into the first, as in MapLibre.
- deck.gl has no square cap or bevel join. A `square` cap is drawn as `butt`, so the line ends
  half its width short. A `bevel` join is cut flat half the line width from the vertex, which
  reaches slightly further than a bevel at sharp corners. A `miter` join sharper than
  `line-miter-limit` is cut flat at the limit, where MapLibre bevels it. `line-round-limit` is not
  applied, which makes no visible difference.
- A flat layer that comes after a `fill-extrusion` layer in the style is hidden behind the
  buildings; MapLibre draws it over them.
- MapLibre cross-fades a zoom-dependent `line-dasharray` between integer zooms; here it switches
  at each integer zoom.
- The outline is 1 CSS pixel wide; MapLibre's is one device pixel.
- `fill-translate`, `line-translate` and `fill-extrusion-translate` (and their `-anchor`
  properties) are not applied. They offset geometry in screen pixels, which deck.gl's polygon
  and path layers have no prop for.

[maplibre-style-spec-js]: https://github.com/maplibre/maplibre-style-spec
