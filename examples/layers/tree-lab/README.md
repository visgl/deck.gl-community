# Tree Lab

Run `yarn workspace @deck.gl-community/tree-lab-example start` from the repository root. All eight species have synchronized native mesh/Gaussian pairs. Seasons, attached and dropped crops, optional WebGL shadows and wind are independently controlled. The resolution control compares a fast 1× render with a sharp 2× render; performance entries always use 1×. Live wind pauses for offscreen specimens and hidden documents. The time slider freezes repeatable poses. The original fixture is frozen from master c8b25275 (9.4.2).

Native wind runs in the vertex shader on both WebGL and WebGPU. Both renderers share the GPU wind field. The five historical mesh species retain their original geometry; banyan and mangrove use opaque leaf-card references with the same growth structure and automatic refinement as their Gaussian counterparts. The frozen Three.js fixture remains available separately through baseline.html. Set `?backend=webgpu` to inspect that backend; shadows are disabled because deck.gl's shadow effect remains WebGL-only.

Open `forest.html` for an exact 10,000 or 20,000 tree forest with all eight species, stable procedural positions and varied dimensions. The scene retains full Gaussian leaf sources and connected woody meshes for close views, with automatic screen-error refinement and animates GPU wind, sunlight, seasons and a canopy flyover. Reduced-motion preferences start all three animations off; controls and an explicit `wind=1` opt in. Increasing the count extends the same forest without moving existing trees. Switch to overview to fit the full forest, drag to explore, or independently toggle wind and shadows. Stats shows a rolling draw count and p95 draw interval, updating once per second; turn it off for a clean presentation. Overview refits on resize. The matching website example is `/examples/layers/tree-forest`.

For comparable performance, use `native.html` and `native.html?renderer=mesh` with identical `count`, `species`, `season`, `crops`, `shadows` and `wind` query parameters. Add `species=mixed` to benchmark the identical forest rows and dimensions. Legacy `detail` query parameters are ignored. Counts are capped at 20,000 and the raw result records the actual instance count; 20K is never silently reduced to 10K. The mixed forest shares the live canopy camera; add `view=overview` to fit the entire dataset in both entries. Each page runs one renderer. Keep the page visible and focused, pause other renderers, and use **Run three samples**, which automatically warms up for two seconds before three five-second camera orbits. Compare draw rates, median/p95 frame delivery, synchronous render-call wall time, long tasks and actual backend/device. Record a one-tree control before and after the matrix to detect scheduling changes. Overview refits on resize; a viewport change during measurement invalidates the sample and requires a new run. Draw counts do not certify presented frames. Neither browser frame intervals nor synchronous render-call wall time measures GPU execution time; do not infer cross-device speed from them. The separate frozen `baseline.html` Three.js renderer retains its original five-species workload and has no wind feature; do not compare it as an equivalent animated workload.

`yarn workspace @deck.gl-community/tree-lab-example build` creates production benchmark entries. The native entry never loads the development-only Three.js fixture. Images and measurements in the review report identify the build, viewport and actual renderer.

The default Auto tour moves the sunlight through a full rotation and cycles spring, summer, autumn and winter every 32 seconds. Manual season or sun-angle controls pause the tour; reduced-motion preferences start with the tour off. Shadow toggles retain the trees while switching the matched lighting effect.

Open `film.html` for a 1920×1080 side-by-side tour. Each species gets 12 seconds and visits every season while the sun and camera move. Record a four-second proof before the full 96-second capture. A fixed 30 fps clock drives both renderers; each requested frame waits for both GPU draws before capture. WebCodecs encodes every requested frame with integer presentation timestamps; the download is VP9/IVF. Convert it with `ffmpeg -i tree-lab-96s.ivf -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart tree-lab-96s.mp4` and verify before sharing. Slow rendering increases export time without dropping seasonal stages.

See [review evidence](REVIEW.md) for the film, seasonal contact sheet, measured geometry budgets and qualified performance samples.

Forest pitch is adjustable through 80°. The shared lab lighting fits a finite ground/crown slab, rejects shadow-map samples outside its volume and fades the far boundary; it covers the species comparison’s trees below 32m without changing the camera pitch.

The shared WebGL lighting follows [NVIDIA's percentage-closer filtering](https://developer.nvidia.com/gpugems/gpugems/part-ii-lighting-and-shadows/chapter-11-shadow-map-antialiasing): native depth comparison samplers compare before interpolating. Four hardware reads reproduce a three-texel tent on tree surfaces. The lab's flat ground uses a reusable, half-resolution coverage mask, filtered horizontally and vertically once per light, then sampled once per ground fragment. This softens small leaflet gaps and silhouette edges without filtering raw depths. Depth maps have a fixed 1024-pixel longest axis, independent of display DPR; the depth pass skips material shading. The ground filter is specific to the lab's plane at -2cm; arbitrary terrain still needs receiver-aware filtering. WebGL regressions cover fractional leaf motion, narrow gaps versus large openings, resized texture replacement, shadow toggles and high pitches in every season.

Canopy consumers use the flat prepared API (`data` owner rows plus `getSource` assets). Tree Lab species share one projected-error allocation instead of fixed row-count shares; World uses the same quota for near and distant crowns. Recorded review videos retain their original renderer and budget fingerprints. The public prepared-source API and its transparency, optical shadow and receiver limitations are documented in [SplatLayer](../../../docs/modules/layers/api-reference/splat-layer.md). Procedural Gaussians approximate botanical foliage; they are not trained photographic assets.

The native mesh reference is frozen from `1d30abb264e51bd0bf89902fb690246348595d9a`; it retains the previous wood and crop placement. Gaussian broadleaf canopies, connected wood and attached fruit share one space-colonization growth structure. Banyan has descending aerial roots; red mangrove has connected stilt roots and larger elliptical leaves. The new species use leaf-card mesh references because no historical mesh exists.


Open `citrus.html` for a focused characteristics workbench. Orchard orange, patio lemon and spreading lime presets expose dimensions, growth seed, crown shape, branching, leaf density and leaf size. Inspect the full crown, faded foliage or branches alone. Crop stages (white blossom, green fruit, ripe fruit, none) are independent of calendar season; citrus stays evergreen. Wind, soft shadows and automatic sunlight/season cycling are independently controlled, and recipe export preserves the chosen parameters. Morphology changes are debounced by 120ms and use bounded shared template caches.

The interactive suite now includes eight species. The committed 84-second film and performance review are the seven-species snapshot from PR #796; they do not measure the added citrus workload. New film exports cycle eight species for 96 seconds.

See [the 20K performance investigation](PERFORMANCE.md) for the lower-level culling, shadow-list and buffer changes. Add `profile=1` to `native.html` for method attribution and luma.gl GPU timestamps in the raw measurements. Profiling changes frame pacing; keep it off for retained draw-rate samples. GPU timestamps require device support and valid queries; rolling metrics are diagnostic rather than presented-frame measurements.

## Streaming world

Open `world.html`. The source partitions exactly 3.04 trillion latent records by default and generates only requested pages. Count controls the global address space; Density redistributes it into equatorial forest patches while keeping the total exact. Both settings are retained in the URL. Rainforest uses varied-height evergreen broadleaf structures with overlapping crowns; Mixed suite retains individual species and calendar seasons. This is a synthetic stress fixture, not surveyed Jaú trees, terrain or taxonomic data.

World and Region show overlapping three-dimensional crown groups. Forest and Crowns stream connected wood and Gaussian foliage, with per-tree screen-center refinement and bounded Gaussian/pixel budgets. Outgoing and incoming source coverage crossfade, with stable tree identities across levels and complementary wood coverage. Dense Gaussian aggregates preserve optical depth rather than capping away leaf density. Geographic pages are internal request/cache units and never render as ground polygons. The camera targets above the tropical crown surface for close inspection.

Use `world.html?zoom=18&pitch=80&density=400&wind=1&shadows=1` and **Measure moving view** for a five-second geographic orbit. Measurements include source transitions if they occur during the sample, and report residency, actual submissions, frame intervals and quality scale. Simplified distant groups do not cast individual-tree shadows. Rainforest remains evergreen through the seasonal controls; Mixed suite tints groups and changes individual foliage. See [TreeLayer geographic streaming](../../../docs/modules/layers/api-reference/world-tree-layer.md) for the source contract, memory limits and hardware-dependent performance boundary.

Crown LOD keeps optical mixtures across camera movement and budget changes. Small view changes retain geographic refinement splits and tree identity, and Gaussian raster resolution stays fixed while geometry feedback adapts. The world demo renders trees against a neutral background without a ground plane. The shadow toggle retains opaque wood self-shadowing; planar canopy transmission and its filter are skipped when there is no ground receiver. World URLs include camera/target settings after interaction, making a problematic view reproducible.

Production examples use the single public `TreeLayer` from `@deck.gl-community/layers`; `getTileData` selects its bounded geographic streaming mode with the same top-level tree accessors. Explicit `ReferenceMeshTreeLayer` and `ReferenceThreeTreeLayer` comparisons are private fixtures under `baseline/`. Existing review videos and JSON fingerprints describe their recorded snapshots.

## Reusing prepared canopy assets

A canopy source and its supplied hierarchy form one reusable asset. The same flat layer can
instance one asset repeatedly or select different assets from row traits:

```ts
import {SplatLayer, createSplatHierarchy, type PreparedSplatData} from '@deck.gl-community/layers';

const asset: PreparedSplatData = {
  type: 'prepared-splats',
  source: canopySource,
  hierarchy: createSplatHierarchy(canopySource, [0.2, 0.5, 1])
};
new SplatLayer({data: trees, getSource: asset, getPosition: tree => tree.position});
new SplatLayer({data: trees, getSource: tree => assets[tree.species], getPosition: tree => tree.position});
```

This is the prepared weighted backend. It does not imply streamed capture loading or sorted
RAD/template overlap. Backend pixel regressions exercise heterogeneous prepared sources and
original-owner picking separately from these historical performance captures.
