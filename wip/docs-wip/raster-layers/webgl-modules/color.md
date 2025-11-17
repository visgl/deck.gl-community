# Color operations

Modules to perform color operations on an existing image.

## `colormap`

Apply a colormap onto a grayscale image.

This is expected to be passed after creating a spectral index, which transforms
the image bands into an index ranging from -1 to 1. Applying a colormap enables
better visualization of this range of data.

#### `image` Transformation

Transforms the internal `image` object from 1 dimension (grayscale) to 3 dimensions (RGB).

### Props

#### `imageColormap`

- [Image object][image_object], required

**Note**: make sure you pass `format: GL.RGB` along with the colormap image;
otherwise the colormap will map the source grayscale image to a different
grayscale image.

The `imageColormap` image is expected to start as a two-dimensional image that
gradually changes color horizontally through the image. The left side of the
image is expected to correspond to -1, and the right is expected to correspond
to 1.

A collection of colormaps is hosted in the `deck.gl-raster` repository, but any
image can be used as the colormap. The color value will be chosen horizontally.
For example, for a value of `0`, the middle pixel value, horizontally, of the
image will be chosen.

Many colormaps are in `assets/colormaps` in PNG format, derived from Matplotlib
and [`rio-tiler`][rio-tiler]. To visualize them, see [colormap
documentation][colormap_docs].

To use them, you can use the jsdelivr CDN, e.g.:

```
https://cdn.jsdelivr.net/gh/kylebarron/deck.gl-raster/assets/colormaps/{colormap_name}.png
```

[rio-tiler]: https://github.com/cogeotiff/rio-tiler
[colormap_docs]: ../../colormaps
[image_object]: ../../layers/raster-layer#images
