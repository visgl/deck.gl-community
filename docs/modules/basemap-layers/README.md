# basemap-layers has moved to tangram.gl

The basemap renderer is now part of [tangram.gl](https://github.com/visgl/tangram.gl),
in the [`@tangram.gl/basemap-layers` package](https://github.com/visgl/tangram.gl/tree/master/modules/basemap-layers).
The `@deck.gl-community/basemap-layers` package, its style-spec entry point and its examples
have been removed from this repository. Existing published community releases remain available.

For new development, follow the [Tangram documentation](https://vis.gl/tangram.gl/) and
check its installation and compatibility requirements before migrating. This is a package
move, not a promise of a drop-in replacement for every community release.

`SharedTile2DLayer`, `SharedTileset2D` and `SharedMVTLayer` remain in
[`@deck.gl-community/geo-layers`](../geo-layers/README.md). The renderer-neutral
conformance corpus remains in `dev/basemap-conformance` for cross-repository consumers.
