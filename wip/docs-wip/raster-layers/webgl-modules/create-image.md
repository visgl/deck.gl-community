# Create Image

## `combineBands`

Load multiple single-band images for display or further processing.

#### `image` Transformation

Creates an internal `image` object where the number of dimensions is equal to
the length of the `imageBands` array.

### Props

#### `imageBands`

- Array of [Image objects][image_object], required

The Image objects represent the bands to combine into a single image.

**Note**: make sure you pass `format: GL.LUMINANCE` along with each image;
otherwise each single-band image will be loaded onto the GPU with multiple
bands, wasting precious GPU memory.

To create a true-color image, you would pass the red, green, and blue image
bands to the `imageBands` prop. To create a false-color image, you would pass
image bands in the desired order to the `imageBands` prop. For example, for a
false-color agriculture image with Landsat 8 data, you would pass textures
corresponding to bands 6, 5, and 2, in that order to the `imageBands` prop.

Alternatively, `combineBands` can be used to assemble bands into an image for
further processing, for example to create a spectral index. The [spectral
indices docs](spectral-indices.md) define which bands must be passed in which
order.

Note that between 1 and 4 images may be passed to `imageBands`. If you only want
to apply a colormap onto a grayscale image, you might pass a single image
texture. If you want to calculate NDVI, you need only pass two image textures.
To create a true-color image you'd need three. The current maximum number of
imageBands is 4.

[image_object]: ../../layers/raster-layer#images

## `rgbaImage`

Load single multi-channel image for display or further processing.

#### `image` Transformation

Creates an internal `image` object where the number of dimensions is equal to
the number of channels in the image. Usually 3 or 4.

### Props

#### `imageRgba`

- [Image object][image_object], required
