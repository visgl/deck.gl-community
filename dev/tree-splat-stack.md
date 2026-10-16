# TreeLayer and SplatLayer example stack

Updated October 16, 2026. #808 has merged. The active landing order is **#809 → #814 → #815**.

| PR | Scope | Base |
| --- | --- | --- |
| [#809](https://github.com/visgl/deck.gl-community/pull/809) | Core TreeLayer and prepared SplatLayer; remove the deprecated Three package; keep a focused TreeLab for species, season and crown spread | `master` |
| [#814](https://github.com/visgl/deck.gl-community/pull/814) | Add scene loading, bounded RAD residency and shared sorted rendering needed for Coit | `codex/remove-three-module` |
| [#815](https://github.com/visgl/deck.gl-community/pull/815) | Add the public Coit SplatLayer example and website wiring | `codex/splat-scene-foundation` |

The regular TreeLayer proof is [TreeLab](../examples/layers/tree-lab): one specimen with a small
species, season and crown-spread control set. The SplatLayer proof is [Coit](../examples/layers/coit),
which exercises the public layer with a real RAD scene. Both examples have matching website entries.

PR [#806](https://github.com/visgl/deck.gl-community/pull/806), which adds tiled TreeLayer streaming
and a synthetic World demo, is closed and deferred. It is outside this release stack.

After each parent lands, update the child base to the merged `master` head and rerun its package,
example and website checks. Recheck CI, reviews and merge state against each current PR head.
