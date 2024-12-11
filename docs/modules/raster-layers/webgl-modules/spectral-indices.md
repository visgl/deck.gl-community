# Spectral Indices

Spectral indices output a single value between -1 and 1 for each pixel. Unless
you want to display a grayscale image, you probably want to [apply a
colormap](color.md#colormap) after computing the index.

## `normalizedDifference`

Computes the normalized difference of two bands:

```
normalized_difference = (x - y) / (x + y)
```

`normalized_difference` always uses the _first two_ bands in the pre-assembled
image as `x` and `y` respectively.

To create the [Normalized difference vegetation index (NDVI)][ndvi], for
example, you would pass the near-infrared band and the red band as the first two
images to the `imageBands` prop in the [`combineBands` module][combine-bands].

## `enhancedVegetationIndex`

Computes the [Enhanced Vegetation Index (EVI)][evi].

Layers are expected to exist as **near-infrared, red, and blue** bands on the
input image, respectively. For example, with Landsat 8 data, you would pass
bands 5, 4, and 2 to the `imageBands` prop in the [`combineBands`
module][combine-bands] in that order.

## `soilAdjustedVegetationIndex`

Computes the [Soil Adjusted Vegetation Index (SAVI)][savi].

Layers are expected to exist as **near-infrared and red** bands on the input
image, respectively. For example, with Landsat 8 data, you would pass bands 5
and 4 to the `imageBands` prop in the [`combineBands` module][combine-bands] in
that order.

## `modifiedSoilAdjustedVegetationIndex`

Computes the [Modified Soil Adjusted Vegetation Index (MSAVI)][msavi].

Layers are expected to exist as **near-infrared and red** bands on the input
image, respectively. For example, with Landsat 8 data, you would pass bands 5
and 4 to the `imageBands` prop in the [`combineBands` module][combine-bands] in
that order.

[ndvi]: https://en.wikipedia.org/wiki/Normalized_difference_vegetation_index
[evi]: https://www.usgs.gov/land-resources/nli/landsat/landsat-enhanced-vegetation-index-evi
[savi]: https://www.usgs.gov/land-resources/nli/landsat/landsat-soil-adjusted-vegetation-index-savi
[msavi]: https://www.usgs.gov/land-resources/nli/landsat/landsat-modified-soil-adjusted-vegetation-index-msavi
[combine-bands]: create-image.md#combinebands
