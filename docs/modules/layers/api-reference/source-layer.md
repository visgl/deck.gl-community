# SourceLayer

`SourceLayer` selects a renderer for a loaders.gl data source. Pass a URL or a `Blob` with an ordered list of loaders, or pass a source instance directly.

```ts
import {SourceLayer} from '@deck.gl-community/layers/source-layers';
import {PMTilesLoaderWithParser} from '@loaders.gl/tiles/pmtiles';
import {MVTLoaderWithParser} from '@loaders.gl/tiles/mvt-loader';

const layer = new SourceLayer({
  id: 'basemap',
  data: 'https://example.com/basemap.pmtiles',
  loaders: [PMTilesLoaderWithParser, MVTLoaderWithParser]
});
```

Source loaders open the input. Parser loaders decode its contents. Use `sourceOptions` to configure the source, and `layers` to select named image or vector layers. By default the layer selects the first named leaf in the source metadata.

The same entry point exports `ImageSourceLayer`, `VectorSourceLayer`, `RasterSourceLayer`, `Tile2DSourceLayer`, `Tile3DSourceLayer`, and `PointCloudSourceLayer` for applications that know the source type in advance.

Use `onSourceLoad` to inspect the resolved source, `onMetadataLoad` to read its metadata, and `onViewStateLoad` to receive a suggested view. The application controls whether to apply that view. `onSourceError` receives errors from source resolution and metadata discovery.

## Choosing a source layer

| Input | Renderer | Behavior |
| --- | --- | --- |
| Image service | `ImageSourceLayer` | Requests imagery for the active viewport. |
| Vector feature service | `VectorSourceLayer` | Queries features and renders their geometry and properties. |
| Raster grid | `RasterSourceLayer` | Converts typed samples to colors. Use `rasterParameters` to select source dimensions or `colorizeRaster` to supply a color map. |
| 2D tile archive or service | `Tile2DSourceLayer` | Selects and loads visible tiles. Set `showTileBorders` to inspect their boundaries. |
| COPC or Potree hierarchy | `PointCloudSourceLayer` | Traverses the hierarchy and renders point tiles. |
| 3D Tiles or I3S | `Tile3DSourceLayer` | Traverses the tileset and renders its content. |

For image and vector services that expose multiple named layers, set `layers` to a name or a list of names. Pass explicit `sourceOptions.core.type` when a URL can represent more than one source type.

## RasterSourceLayer

`RasterSourceLayer` requests the active viewport through `RasterSet` and renders typed samples with `BitmapLayer`, or with `RasterBitmapLayer` when `rendering` is `'gpu'`. The default colorizer uses tagged RGB or grayscale bands when available, with sampled 2nd and 98th percentile scaling and a blue-to-yellow single-band ramp. It displays tagged 8-bit RGB values as stored. With no display tags, including with loaders.gl 5.0.0-rc.2 GeoTIFF sources, it stretches the first three bands for RGB or uses the first band for the single-band ramp.

When a source supplies a tagged alpha band, the colorizer scales opacity using the full range for unsigned samples, 0–1 for floating-point samples, and clamped byte values for signed samples. It converts premultiplied colors to straight colors. For tagged RGB with no alpha band, a pixel is transparent when all three channels match their no-data values. Masks and non-finite samples also make pixels transparent.

Bounds can be in EPSG:4326, EPSG:3857, a supported projected CRS, or a geographic CRS supplied through `resolveCRSDefinition` (see [Projected rasters](#projected-rasters)). CRS identifiers may be supplied as strings or authority-coded PROJJSON definitions. Rasters without geospatial bounds render in pixel coordinates in `OrthographicView`.

Use `rasterParameters` for source-specific dimensions, `getRasterParameters` for custom requests, and `colorizeRaster` for application color maps.

The default request preserves the viewport's aspect ratio when scaling to `maxTextureSize`. With inferred placement, `BitmapLayer` samples longitude and latitude per pixel for geographic rasters. EPSG:3857 rasters use the default Web Mercator sampling. A `colorizeRaster` result that supplies both `bounds` and `coordinateSystem` controls placement and uses the bitmap sublayer's default `_imageCoordinateSystem`. Set `bitmapLayerProps._imageCoordinateSystem` to override image sampling.

## Projected rasters

MapView and GlobeView support projected CRSs that math.gl can resolve, such as WGS 84 / UTM zone 26N (`EPSG:32626`). The layer requests the visible portion of the source extent in source coordinates.

Set `resolveCRSDefinition(identifier)` to return a projected or geographic CRS definition as a PROJ string or WKT. For example, return `+proj=longlat +datum=NAD83 +no_defs` for `EPSG:4269`. The callback can return a definition synchronously or through a promise. Return `null` or `undefined` to fall back to identifier lookup. The layer calls the callback once when metadata loads for an identifier outside its built-in set (`EPSG:4326`, `CRS:84`, `OGC:CRS84`, and `EPSG:3857`).

Raster requests keep the source identifier and express bounds in source coordinates. Both CPU and GPU bitmap rendering use the resolved definition for placement. For projected CRSs, you can also configure a CRS resolver on the math.gl projection engine or supply WKT as the source CRS.

`RasterSourceLayer` forwards `bitmapLayerProps` to `BitmapLayer`. With deck.gl 10.0.0-alpha.2, do not set `bitmapLayerProps._projectionTolerance` to a nonzero value for a projected raster (for example UTM) in `MapView` or `GlobeView`. These views pack the raster to WGS84, and `BitmapLayer` then throws `_projectionTolerance requires projected coordinates with linear units`. Keep the value unset or `0` in these views. [visgl/deck.gl#11343](https://github.com/visgl/deck.gl/pull/11343) adds support for these views.

## Using the community entry point

Examples that already use the private loaders.gl module can change the layer import while keeping their loader list, source options, and callbacks.

```diff
-import {SourceLayer} from '@loaders.gl/deck-layers';
+import {SourceLayer} from '@deck.gl-community/layers/source-layers';
```

Install a version of `@deck.gl-community/layers` that exports this subpath and use compatible deck.gl and loaders.gl versions. Continue importing format loaders from loaders.gl. For a source that needs a separate payload parser, pass both in the same ordered list. Raster PMTiles can decode image tiles directly.

The [Mount Whitney example](/examples/layers/source-layers) demonstrates the URL-plus-loaders pattern with a local raster archive. Its status label displays the resolved source type. Applications that control the view can also use `onViewStateLoad` to fit the source extent.
