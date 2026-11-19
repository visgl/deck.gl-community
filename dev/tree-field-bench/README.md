# TreeLayer field benchmark

Measure 20,000 deterministic trees through an overview, a close tree view, and a tilted dive. The scene uses the checked-out TreeLayer source, a light breeze, a fixed LOD bias of zero, and device pixel ratio 1. The default is a citrus field on WebGL2. Pass `--field mixed` for multiple species or `--backend webgpu` to exercise WebGPU.

Both backends use a directional map that snaps to world-space texels and blends between map sizes. Ground shadows use the same strength throughout the field. Use `--paths macro` to inspect the 16 m shadow fit at a camera distance of 2 m. The JSON reports the fitted span and texel size.

```sh
yarn
yarn playwright:install
yarn node dev/tree-field-bench/bench.mjs --out /tmp/tree-field.json
```

Each path starts in a fresh page. The JSON records backend, renderer, physical canvas size, LOD bias, peak tree counts per species and detail tier, separate shell-to-leaf transition peaks, draw count, raw frame intervals, and optional GPU timer results. Frame intervals include presentation cadence. GPU timings sample every fourth draw and require `EXT_disjoint_timer_query_webgl2`. Check the renderer before comparing hardware results.

Use the same viewport and frame counts for both revisions. Pass `--frame-timing-only` to measure presentation without GPU timer queries. For a larger canvas, pass `--width 2560 --height 1600`. For a smoke run, pass `--paths tree --frames 20 --warmup 20`. A 60 fps frame budget is 16.7 ms.

## Matched comparisons

See [PR #1095](https://github.com/visgl/deck.gl-community/pull/1095) for the compact
comparison, validation and measurement limitations. Raw frames and full-resolution
captures are kept outside the source diff.

`--width` and `--height` are CSS pixels. `--dpr` controls the physical drawing buffer.
For a 1312 × 779 viewport rendered at 2624 × 1558, use:

```sh
yarn node dev/tree-field-bench/bench.mjs --headed --width 1312 --height 779 --dpr 2 \
  --count 20000 --ground 0 --shadows 0 --profile --frame-timing-only \
  --paths overview,tree,dive,tint --frames 120 --warmup 60 --out /tmp/trees.json
```

`--ground 0 --shadows 0` isolates trees from the ground receiver and shadow passes.
Imagery and terrain are absent from this fixture. `--shadows 1` measures caster and
self-shadow cost separately. Keep dimensions, lighting, device, browser, resolution and
all other flags identical between revisions. `--headed` runs a visible native browser;
check the reported renderer rather than assuming it uses hardware.

`--profile` adds raw per-frame CPU method timings, GL draw calls and submitted indices
(non-indexed vertices for non-indexed draws), buffer uploads,
texture writes, tracked GPU allocations and Chromium's JS heap estimate. These are
submission counts, not unique post-cache vertex invocations. `tint` changes only the
canopy color trigger in a fixed view. `--selection` attaches an unselected
`SelectionPulseExtension` to reproduce selection-enabled consumers. `--cpu-profile /tmp/tree-cpu` also writes one
Chromium CPU profile per path. `--gl-debug` records GL errors at individual calls and
adds synchronization overhead; use it for diagnosis, not timing comparisons.
Both measured and warmup GL errors fail the runner, including without `--gl-debug`.

Buffer counters classify direct `UNIFORM_BUFFER` uploads separately. Other buffer
uploads can also contain uniforms written through `COPY_WRITE_BUFFER`; they are not
an attribute-only count. `_updateAttributesMs` measures attribute-manager CPU work.

Set `TREE_LAYER_ENTRY` to an absolute TreeLayer module entry to compare a published
package with the checked-out source, without changing workspace dependencies. The
module must resolve its own peer dependencies to the same Deck and Luma installation.
The selection extension is resolved from the same source tree or published package;
`TREE_SELECTION_ENTRY` overrides it for nonstandard layouts. Use `--label` to record the
package version or commit. Older renderers without photoreal
tiers require `--profile` so submitted draws can be verified.

`--theme bright` supplies synthetic yellow/green canopy classes through TreeSpec colors.
`--theme realistic` leaves canopy colors unset, retaining the botanical palette at opacity
0.7. Bright defaults to opacity 1. `--opacity 1` holds transparency constant for shader
comparisons. Explicit colors automatically use the authored-color path; no color-mode
property is required. These are public synthetic classes, not customer field data.
`--screenshot /tmp/bright` saves a PNG per path after timing, e.g. `/tmp/bright-tree.png`.
Use `--wind-time 12` for the same wind phase in before/after captures. Leave it unset
for timing runs with animated wind.

## Interactive field

```sh
yarn vite --config dev/tree-field-bench/vite.config.ts --port 4396 --strictPort
```

Open [the field playground](http://127.0.0.1:4396/playground.html). The Tree view orbits the selected trunk base. Leaf uses a canopy pivot for inspection. Click a tree to select it, then change its height, crown radius or foliage. The playground keeps LOD bias at zero and reports color candidates, transitioning crowns, and shadow casters separately. Transitioning crowns also belong to a color-shell bucket. Add `?backend=webgpu` to compare the same field on WebGPU.
