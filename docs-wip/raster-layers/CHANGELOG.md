# Changelog

## [0.3.1] - 2020-09-07

- Remove comments from GLSL strings for reduced bundle size.
- Update web documentation.
- Add prettier config for more standardize code format.

## [0.3.0] - 2020-08-07

- Add new `images` prop. Enables applications to pass `image` objects (i.e.
  `ImageData` or `ImageBitmap`) without touching the `gl` context. Previously
  the application had to pass `Texture2D` objects to the
  `RasterLayer`/`RasterMeshLayer`.

## [0.2.3] - 2020-06-27

- Add `imageRgba` module where the input is a 3 or 4 band image.

## [0.2.2] - 2020-06-25

- Relax peerDependency version requirements

## [0.2.1] - 2020-06-22

- Update `RasterLayer` for use with deck.gl 8.2 (since `BitmapLayer` changes to use a mesh to support `GlobeView`)

## [0.2.0] - 2020-05-02

- Remove `PanBandsBitmapLayer` and include pansharpening into the `BandsBitmapLayer`.
- Support normalized difference and other simple non-RGB band combinations
- Apply colormaps onto normalized difference

## [0.1.0]

- Initial release
