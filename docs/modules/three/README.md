# Overview

`@deck.gl-community/three` is deprecated. It temporarily re-exports the native
[`TreeLayer`](../layers/api-reference/tree-layer.md) from `@deck.gl-community/layers`.
The compatibility package contains no Three.js runtime or separate renderer.

Update imports to `@deck.gl-community/layers`. The native API supports eight procedural
species, Gaussian foliage, connected wood, seasons, crops, wind and owner picking.
See the [migration notes](../layers/api-reference/tree-layer.md#migration) for removed
manual detail modes, canopy overrides and crop radius changes.
