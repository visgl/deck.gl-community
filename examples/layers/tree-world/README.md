# Tree World

A synthetic streaming inventory using public `TreeLayer({getTileData, ...})`.
It generates only requested pages from a configurable latent address space;
the default 3.04 trillion positions are synthetic, not an observed inventory.

Run `yarn workspace @deck.gl-community/tree-world-example start` from the repository root.
Count, density, structure, season, wind and camera controls are retained in the URL.
Rainforest stays evergreen; Mixed suite follows seasons. Measure moving view reports
frame intervals and bounded residency for the current configuration.

The example has no ground plane. Its specialized WebGL lighting retains opaque wood
self-shadows and skips planar canopy transmission when there is no ground receiver.
These lighting/wind/profiling helpers belong to World, not the small TreeLayer garden.
See the [streaming reference](../../../docs/modules/layers/api-reference/world-tree-layer.md)
for source, memory and performance limits.
