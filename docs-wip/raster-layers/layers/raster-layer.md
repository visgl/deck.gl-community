# `RasterLayer`

The `RasterLayer` is a subclass of deck.gl's built-in
[`BitmapLayer`][bitmaplayer] that enables image operations on satellite image
bands. All image operations are done on the GPU for best performance.

[bitmaplayer]: https://deck.gl/docs/api-reference/layers/bitmap-layer

You can combine RGB bands in true color or false color manners, or create a
spectral index and apply a colormap. With true color imagery, you can apply
pansharpening from a panchromatic band. If an operation hasn't been implemented
yet, it's relatively easy to add your own operations.

## Props

#### `modules`

- `array`: default `[]`

An array of [WebGL modules](../../webgl-modules/overview) that define the
pipeline to be run on the GPU. **Note that the order of `modules` is
important,** since modules are applied in the same order. If you wanted to
create NDVI with a colormap, you'd want `modules` to be something like:

```js
[combineBands, normalizedDifference, colormap];
```

If the order were instead:

```js
[combineBands, colormap, normalizedDifference];
```

you'd likely see an unintelligible grayscale image. That's because the
`colormap` step first transforms the internal `image` object from one dimension
to three, and then the `normalizedDifference` step takes the first two
dimensions of the colormapped image and transforms back to a single dimension.
That one dimension will be rendered as grayscale.

#### `images`

- `Object`: default `{}`

An object containing image data for use in the WebGL modules.

The object's keys should be strings corresponding to the desired module's
property name, and the values should be an object containing Image data or
[Texture2D][texture2d_api] objects, or an array of these objects.

For example, say I have two independent images representing the near-infrared
(NIR), and red image bands from a satellite. I'd pass an `images` object like
the following:

[texture2d_api]: https://luma.gl/docs/api-reference/webgl/texture-2d

```js
// Copyright 2022 Foursquare Labs, Inc. All Rights Reserved.

import GL from '@luma.gl/constants';

images = {
  imageBands: [
    // NIR band
    {
      data: ImageData,
      // Use format: GL.LUMINANCE when the ImageData only has one band/channel
      // Otherwise use GL.RGB or GL.RGBA
      format: GL.LUMINANCE
    },
    // red band
    {
      data: ImageData,
      format: GL.LUMINANCE
    }
  ]
};
```

If I additionally wanted to apply a pansharpening step, for example, I'd add a
new key named `imagePan` in the `images` object, and include the
`pansharpenBrovey` module in the `modules` array above.

Note that when image data is passed as an object, it is internally passed on to
Luma.gl's [Texture2D][texture2d_api]. For full control over rendering, consult
its documentation for additional texture parameters.

Any image data should be passed through `images` rather than through
`moduleProps`, as the former will provide better performance and allow you to
not touch the underlying GL context.

#### `moduleProps`

- `Object`: default `{}`

An object containing non-image properties to be passed to modules. For example,
if `pansharpenBrovey` is included in your `modules` list and you wanted to
change `panWeight`, you would pass `moduleProps` as:

```
moduleProps: {
  panWeight: 1.0;
}
```

Refer to the [WebGL Modules](../../webgl-modules/overview) documentation to see
available props exposed by each module.

#### BitmapLayer Props

This layer inherits [all props][bitmaplayer_props] from the built-in deck.gl
`BitmapLayer`.

[bitmaplayer_props]: https://deck.gl/docs/api-reference/layers/bitmap-layer
