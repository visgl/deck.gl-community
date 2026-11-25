# SourceLayer

`SourceLayer` selects a renderer for a loaders.gl data source. Pass a URL or a `Blob` with an ordered list of loaders, or pass a source instance directly.

```ts
import {SourceLayer} from '@deck.gl-community/layers/source-layers';
import {PMTilesLoader} from '@loaders.gl/tiles/pmtiles';
import {MVTLoader} from '@loaders.gl/tiles/mvt';

const layer = new SourceLayer({
  id: 'basemap',
  data: 'https://example.com/basemap.pmtiles',
  loaders: [PMTilesLoader, MVTLoader]
});
```

Source loaders open the input. Parser loaders decode its contents. Use `sourceOptions` to configure the source, and `layers` to select named image or vector layers. By default the layer selects the first named leaf in the source metadata.

The same entry point exports `ImageSourceLayer`, `VectorSourceLayer`, `RasterSourceLayer`, `Tile2DSourceLayer`, `Tile3DSourceLayer`, and `PointCloudSourceLayer` for applications that know the source type in advance.

Use `onSourceLoad` to inspect the resolved source, `onMetadataLoad` to read its metadata, and `onViewStateLoad` to receive a suggested view. The application controls whether to apply that view. `onSourceError` receives errors from source resolution and metadata discovery.
