# basemap-layers

An implementation of a subset of the [Mapbox Style
Specification][mapbox_style_spec] using deck.gl layers.

_A work in progress_.

[mapbox_style_spec]: https://docs.mapbox.com/mapbox-gl-js/style-spec/

## Motivation

Mapbox GL JS is now closed source, and a built-in simple deck.gl solution may be
enough for many applications where the data visualization is more important than
the basemap.

This is not intended to be a full basemap implementation.

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
- `type`: one of: `background`, `fill`, `line`, `symbol`, `raster`, `circle`, `fill`,-extrusion `heatmap`, `hillshade`, `sky` (v2 only).
- `source`: must be one of the keys defined in the initial `sources` object. So here each must be either `satellite-source` or `vector-source`.
- `source-layer`: For vector sources, each styling layer is rendered on only a single vector tile layer within the source. So when `source-layer` is `landuse`, the vector tiles provided by the `vector-source` source are expected to contain a layer named `landuse`, and this styling layer will apply only to that layer. This is required for vector sources.
- `minzoom`, `maxzoom`: zoom range for layer. Falls back to source's available zoom range, but can be a narrower range than the source provides
- `filter`: A filter expression that is tested against every object within the vector tile layer.
- `layout`: A layout expression. These are less commonly used, and usually don't have a great equivalent in deck.gl.
- `paint`: Properties used for styling. Each layer type has a list of available paint properties. All properties except `visibility` are prefixed by the layer's type, hence `fill-color` and `line-width`. The value of each paint property can be either a constant value or color, or a styling expression that changes appearance based on zoom.

## Implementation

The simplest approach would be to map each Mapbox layer to a deck.gl layer. Most
Mapbox layers have a deck.gl equivalent:

| Mapbox Layer Type | deck.gl Layer               |
| ----------------- | --------------------------- |
| `background`      | `BitmapLayer`               |
| `fill`            | `MVTLayer` (`PolygonLayer`) |
| `line`            | `MVTLayer` (`LineLayer`)    |
| `symbol`          | `IconLayer/TextLayer`       |
| `raster`          | `BitmapLayer`               |
| `circle`          | `MVTLayer` ?                |
| `fill-extrusion`  | `MVTLayer` (`PolygonLayer`) |
| `heatmap`         | `HeatmapLayer`              |
| `hillshade`       | N/A                         |
| `sky` (v2 only)   | N/A                         |

Mapbox GL JS [exposes a standalone parser][mapbox-style-spec-js] for their style specification. (This is apparently [still open source][mapbox-style-spec-js-license] in v2). This parser is quite helpful, it:

- parses all permissible color descriptions into an rgba array
- Evaluates filter expressions for each GeoJSON `Feature` input
- Evaluates paint expressions given the zoom level

[mapbox-style-spec-js]: https://github.com/mapbox/mapbox-gl-js/blob/main/src/style-spec/README.md
[mapbox-style-spec-js-license]: https://github.com/mapbox/mapbox-gl-js/blob/0063cbd10a97218fb6a0f64c99bf18609b918f4c/src/style-spec/package.json#L11
