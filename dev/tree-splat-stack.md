# TreeLayer and SplatLayer example stack

Updated October 16, 2026. #808 has merged. The active landing order is **#809 → #814 → #815**.

| PR | Scope | Base |
| --- | --- | --- |
| [#809](https://github.com/visgl/deck.gl-community/pull/809) | Core TreeLayer and prepared SplatLayer; remove the deprecated Three package; use one complete TreeLayer showcase | `master` |
| [#814](https://github.com/visgl/deck.gl-community/pull/814) | Add scene loading, bounded RAD residency and shared sorted rendering needed for Coit | `codex/remove-three-module` |
| [#815](https://github.com/visgl/deck.gl-community/pull/815) | Add the public Coit SplatLayer example and website wiring | `codex/splat-scene-foundation` |

The regular TreeLayer proof is [TreeLab](../examples/layers/tree-lab): one interactive showcase that
opens on a citrus specimen and switches to a compact eight-species grove. The same controls adjust
species, season, height, morphology, wind, and seasonal crops. Coit remains the separate SplatLayer
proof for a real RAD scene.

PR [#806](https://github.com/visgl/deck.gl-community/pull/806), which adds tiled TreeLayer streaming
and a synthetic World demo, is closed and deferred. It is outside this release stack.

After each parent lands, update the child base to the merged `master` head and rerun its package,
example and website checks. Recheck CI, reviews and merge state against each current PR head.
