# TreeLayer field benchmark

Measure 20,000 deterministic trees through an overview, a close tree view, and a tilted dive. The scene uses the checked-out TreeLayer source, a light breeze, a fixed LOD bias of zero, and device pixel ratio 1. The default is a citrus field on WebGL2. Pass `--field mixed` for multiple species or `--backend webgpu` to exercise WebGPU.

Both backends use a directional map that snaps to world-space texels and blends between map sizes. Ground shadows use the same strength throughout the field. Use `--paths macro` to inspect the 16 m shadow fit at a camera distance of 2 m. The JSON reports the fitted span and texel size.

```sh
yarn
yarn playwright:install
yarn node dev/tree-field-bench/bench.mjs --out /tmp/tree-field.json
```

Each path starts in a fresh page. The JSON records backend, renderer, physical canvas size, LOD bias, peak tree counts per species and detail tier, draw count, raw frame intervals, and optional GPU timer results. Frame intervals include presentation cadence. GPU timings sample every fourth draw and require `EXT_disjoint_timer_query_webgl2`. Check the renderer before comparing hardware results.

Use the same viewport and frame counts for both revisions. For a larger canvas, pass `--width 2560 --height 1600`. For a smoke run, pass `--paths tree --frames 20 --warmup 20`. A 60 fps frame budget is 16.7 ms.
