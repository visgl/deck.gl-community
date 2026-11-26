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

## Using the community entry point

Examples that already use the private loaders.gl module can change the layer import while keeping their loader list, source options, and callbacks.

```diff
-import {SourceLayer} from '@loaders.gl/deck-layers';
+import {SourceLayer} from '@deck.gl-community/layers/source-layers';
```

Install a version of `@deck.gl-community/layers` that exports this subpath and use compatible deck.gl and loaders.gl versions. Continue importing format loaders from loaders.gl. For a source that needs a separate payload parser, pass both in the same ordered list. Raster PMTiles can decode image tiles directly.

The [Mount Whitney example](/examples/layers/source-layers) demonstrates the URL-plus-loaders pattern with a local raster archive. Its status label displays the resolved source type. Applications that control the view can also use `onViewStateLoad` to fit the source extent.
