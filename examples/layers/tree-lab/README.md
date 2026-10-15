# TreeLayer

Inspect one tree at a time. Switch species or season, adjust crown spread, and
toggle the full tree shadow. The wood uses deck.gl's opaque shadow map; a separate
optical pass projects the translucent canopy onto the ground. The floating label
does not cast a shadow. Drag to pan, scroll to zoom, and hover to identify the specimen.

Run `yarn workspace @deck.gl-community/tree-lab-example start` from the repository root.
The website also provides WebGL2/WebGPU device tabs; tree shadows are available
with WebGL2.
