# Mount Whitney source layers

Run `yarn workspace @deck.gl-community/example-source-layers start` from the repository root. Pan or zoom to request raster tiles from the bundled Mount Whitney archive. The example passes its URL and the PMTiles loader to the community `SourceLayer`, following the loaders.gl tiles example.

The archive is the [USGS Mount Whitney PMTiles fixture from loaders.gl](https://github.com/visgl/loaders.gl/blob/7a12b002ee/modules/tiles/test/pmtiles/data/pmtiles-v3/usgs-mt-whitney-8-15-webp-512.pmtiles). It contains WebP tiles at zoom levels 8 through 15.
