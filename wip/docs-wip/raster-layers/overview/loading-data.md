# Loading Data

Historically, due to its storage requirements and complexity, satellite image
data has been hard to bring into the browser. [That is
changing][cog-intro-blog-post], however, with the advent of [Cloud-Optimized
GeoTIFFs][cogeo], an efficient file format for accessing remote raster data, and
[Spatio-Temporal Asset Catalog][stac], a standardized metadata format.

[cog-intro-blog-post]: https://kylebarron.dev/blog/cog-mosaic/overview
[cogeo]: https://cogeo.org
[stac]: https://stacspec.org/

There are two main ways to load data, either directly from a data store such as
S3, or through a server. If you plan to access data directly, your format is
decided by how the data is already stored, usually either GeoTiff (hopefully
Cloud-Optimized GeoTIFF) or Zarr. If you put a server in the middle, you should
load data in Numpy format for lossless high bit-depth data or PNG for lossless
8-bit data.

## Image Formats

### PNG

PNG is a common lossless image format that can support both 8-bit and 16-bit
data. Unfortunately, web browsers only natively support decoding 8-bit PNGs;
16-bit PNGs will be silently corrupted. Thus, to support decoding 16-bit PNGs,
you need to include an external dependency, such as
[UPNG.js](https://github.com/photopea/UPNG.js).

Thus PNGs are best suited when you want to load 8-bit data.

### JPEG

JPEG is a common _lossy_ image format that supports 8-bit data. Due to its lossy
compression, JPEG's file sizes are generally smaller than all other formats.

If you care about file size at all costs, and don't expect to use images for
analytical use, use JPEG.

### WebP

WebP is a newer lossless image format than PNG with smaller file sizes. Browsers
can only natively decode 8-bit WebP images. Additionally, browser support is not
perfect: [only the most recent release](https://caniuse.com/webp) of Safari
supports WebP.

If you want to load 8-bit lossless data, and either don't care about older
browsers, or are able to use content negotiation to provide PNGs to older
browsers, use WebP.

### GeoTIFF

The GeoTIFF is a very common raster data format, but browsers don't natively
support decoding TIFFs, and thus a [relatively large][geotiff.js-size] external
dependency —[`geotiff.js`][geotiff.js]— is needed.

Use GeoTIFF when you want to load source data directly from the browser, without
a server in the middle.

[geotiff.js-size]: https://bundlephobia.com/result?p=geotiff
[geotiff.js]: https://geotiffjs.github.io/

## Array Formats

### Numpy format

Numpy, the popular Python array-processing library, has its [own data
format][npy-format]. The benefit of this format is its simplicity: it can be
decoded simply and without a large external dependency. From the [original
specification][npy-nep]:

> The format stores all of the shape and dtype information necessary to
> reconstruct the array correctly even on another machine with a different
> architecture. The format is designed to be as simple as possible while
> achieving its limited goals

`deck.gl-raster` currently includes an NPY parser, though beware this may move
to another library, such as [loaders.gl](https://loaders.gl), in the future.

The NPY format is best suited to small images as it doesn't support streaming.
If you are loading image data from a backend, as opposed to loading image data
directly from S3, NPY may be the best approach as it allows full bit-depth data
without a complex dependency.

[npy-format]: https://numpy.org/doc/stable/reference/generated/numpy.lib.format.html
[npy-nep]: https://numpy.org/neps/nep-0001-npy-format.html

### Zarr

[Zarr][zarr] is a Python package and corresponding file format for "chunked,
compressed, N-dimensional arrays". Similar to Cloud-Optimized GeoTIFF, it
supports efficient streaming from remote datasets. There's a [JavaScript
client][zarr-js], which should enable bringing Zarr data into the browser.

Zarr would be best suited towards a _collection_ of data, where each individual
chunk represents a single "tile" that would be rendered with a modified deck.gl
`TileLayer`.

[zarr]: https://zarr.readthedocs.io/en/stable/
[zarr-js]: http://guido.io/zarr.js
