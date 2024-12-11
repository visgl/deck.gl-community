# Color operations

Modules to perform pansharpening on an existing image.

## `pansharpenBrovey`

Use the [Weighted Brovey][weighted-brovey] method to pansharpen an image.

This is expected to be used on a true-color three-band RGB image.

### Props

#### `imagePan`

- `Texture2D`, required

A [`Texture2D`][texture2d] object representing the panchromatic band of a
satellite image scene.

#### `panWeight`

- `Number`, default `0.2`

Weight of blue band. `0.2` is suitable for Landsat imagery. To perform
non-weighted Brovey pansharpening, pass `panWeight: 1`. From
[here][weighted-brovey]:

> Particularly for Landsat 8 imagery data, we know that the pan-band does not
> include the full blue band, so we take a fraction of blue (optimal weight
> computed in this sprint) in the pan-band and use this weight to compute the
> sudo_pan_band, which is a weighted average of the three bands. We then compute
> the ratio between the pan-band and the sudo-band and adjust each of the three
> bands by this ratio.

### Credits

`pansharpenBrovey` is ported from [`rio-pansharpen`][rio-pansharpen] under the
MIT license.

[rio-pansharpen]: https://github.com/mapbox/rio-pansharpen
[weighted-brovey]: https://github.com/mapbox/rio-pansharpen/blob/master/docs/pansharpening_methods.rst#weighted-brovey
[texture2d]: https://luma.gl/docs/api-reference/webgl/texture-2d
