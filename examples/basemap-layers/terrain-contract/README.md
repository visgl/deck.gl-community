# Shared terrain contracts

Run `yarn workspace basemap-terrain-contract-example start-local` from the repository root.
The example is also available under the website's BasemapLayer examples.

This offline fixture uses the same north-first `[0, 10, 20, 30]` physical grid as
the loaders.gl and Tangram contract tests. Its footprint is EPSG:3857 meters and
its datum is explicitly unknown. It draws two planar triangles in an OrbitView,
with explicit identity common-to-surface conversion because both use those same
Cartesian meter coordinates. The exaggeration slider changes displayed geometry,
not reported physical elevation.

Hover to inspect the actual finite camera ray. The small analytic plane provider
is a fixture, not a production terrain index. No live tiles, image decoding,
terrain meshing, no-data repair, mixed-LOD stitching or draping are claimed.
`pickTerrainSurface` also accepts providers implementing loaders.gl's proposed
terrain contract or Tangram's existing `TerrainSurface` interface without a
runtime dependency on either package. A future release can replace the structural
type declarations with type imports; community remains on its current 4.x stack.
