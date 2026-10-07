# Tree Lab review evidence

## Seven-species Gaussian suite

[Watch the 84-second mesh/Gaussian film](../../../website/static/videos/tree-lab-splats.mp4) and inspect [all 28 seasonal stages](../../../website/static/videos/tree-lab-splats-seasons.jpg). The 1920×1080 H.264 film contains exactly 2,520 frames at 30 fps, with zero application rendering errors. Full decode passed. Sunlight and wind share one fixed clock. Pine, oak, palm, birch and cherry retain their frozen native mesh references; the newly added banyan and red mangrove use opaque leaf-card references with the same growth, wood and refinement as their Gaussian counterparts.

Broadleaf crowns grow through bounded space colonization, with pipe-model taper and transported tube frames. Wood, leaf clusters and contained attached fruit share those shoots. Banyan aerial roots and mangrove stilt roots are part of the same closed connected mesh. Mangrove foliage uses larger elliptical leaves. Wind combines clamped cubic bending with a spatial crown mode; the analytic Jacobian deforms covariance and inverse-transpose normals. These are procedural botanical models, not trained photographic trees or a mechanical stress solver. See [growth math and sources](../../../docs/modules/layers/api-reference/tree-layer.md#procedural-growth-and-motion).

[Raw final samples, source/build hashes and geometry budgets](splat-review.json) retain the complete seven-species matrix. One Apple M4 Pro/ANGLE Metal production renderer ran at a time, at 587×680 and 1× pixels. Each workload used a two-second warmup and three five-second 90° camera orbits, summer foliage, wind and shadows on, and crops off. No builds, tests or encodes ran during measurement.

| Renderer | 10,000 trees: median draws/s (range) | 20,000 trees: median draws/s (range) |
| --- | --- | --- |
| Gaussian foliage | 34.7 (33.1–35.3) | 31.5 (30.9–31.7) |
| Mesh reference | 45.7 (45.4–46.4) | 34.7 (34.7–35.6) |

All retained samples had zero rendering errors. One 20K Gaussian sample recorded one long task; the other samples had none. One-tree controls before and after the matrix had 8.3ms median intervals, with median draw rates of 114.7 and 114.9. The richer Gaussian workload remains slower than this mesh reference. Draw rates describe submitted draws and browser delivery, not GPU execution or certified presented FPS. These summer canopy-view measurements do not establish winter, overview, mobile or WebGPU performance.

Verification: 62 Node/example tests, 14 WebGL pixel tests, and two actual backend tests pass. Checks cover all fourteen comparison surfaces, four seasons, evergreen foliage presence, owning-tree picking, wind poses, 10K/20K count/view changes, connected topology, crop containment, optical shadow filtering and pitches through 80°. WebGPU rendering used SwiftShader and is separate from the hardware WebGL performance matrix. Root package/declaration build, Tree Lab typecheck/build and lint pass. Website validation is recorded with this change.

## Historical native mesh implementation

The results below describe earlier five-species mesh versions and are retained as historical evidence. Their films, source fingerprints, detail settings and timings do not describe the current Gaussian suite.


The current layer always uses the former high-detail trunk and canopy meshes. Detail selectors and query inputs are removed. Medium/low measurements below are historical; their source fingerprints identify the measured versions.

[Watch the 60-second comparison](../../../website/static/videos/tree-lab-native.mp4) or inspect [all 20 seasonal stages](../../../website/static/videos/tree-lab-seasons.jpg). The website Tree Lab page embeds the film above the interactive comparison. Original geometry is frozen from master c8b25275 (9.4.2). Both columns share camera, light, dimensions and supplied crop configuration; the original has no wind and is labelled static.

The film includes pine, oak, palm, birch and cherry, with 12 seconds per species and three seconds per season. Sunlight rotates, shadows move, and native trunks, crowns and attached crops bend. The final download contains exactly 1,800 paired and encoded frames with zero application rendering errors. Converted H.264 output is 1920×1080 at 30 fps for 60 seconds; a full decode and presentation timestamp check passed. All 20 tree/season combinations were inspected in the contact sheet. Film SHA-256: `d2cde8d23de2b970a29471bd2ee035e2b69c0c956f93197b41ddac0912d539dd`.

The refreshed film uses native comparison depth maps and softened ground coverage in both columns. Winter leaders meet the trunk at its physical top radius without the former independent pitch, then smoothly taper into the branch structure. Cached mesh rings and an instance radius keep the join dimension-aware without per-tree mesh allocation.

## Geometry and performance

Native palm canopy triangles decrease from 4,448 to 1,760 at high detail, 1,224 at medium and 648 at low. Broadleaf high detail adds triangles to smooth the crown; low detail reduces them. Native geometry uses shared bounded CPU caches and instanced deck.gl meshes. Wind changes uniforms without regrouping trees or regenerating instance attributes. Production implementation chunks measure 101,543 bytes for the frozen original and 23,873 bytes for native; shared deck.gl/luma infrastructure is excluded.

[Raw retained samples and geometry budgets](review.json) record the actual device and workload. On one Apple M4 Pro through ANGLE Metal, with one production renderer at a time, three five-second 90° camera orbits at 1236×680 and 1× pixels delivered:

| Workload | Three median frame intervals | Three p95 frame intervals | Long tasks/errors |
| --- | --- | --- | --- |
| Original, 5,000 palms | 15.9 / 16.2 / 15.7 ms | 17.5 / 17.3 / 17.6 ms | 0 / 0 |
| Native high, 5,000 palms | 8.3 / 8.3 / 8.3 ms | 9.2 / 16.7 / 9.2 ms | 0 / 0 |
| Native high, 1,000 oaks + 44,000 crops + wind + filtered WebGL shadows | 8.3 / 8.3 / 8.3 ms | 9.1 / 9.1 / 9.3 ms | 0 / 0 |

These are browser delivery intervals, not GPU execution time or universal FPS claims. Earlier warm original palm medians varied down to 9.3 ms; oak medians were 8.3 ms for both renderers. Scheduling and system load matter. These samples precede the final picking, override, recorder, shadow depth and winter join fixes. No mobile or physical-device performance claim is made.

## Verification boundaries

Root package/type/declaration build, Node tests, website build, Tree Lab typecheck/build and lint pass. The Tree Lab browser regression uses actual WebGL pixels to check all ten surfaces through shadows on → off → on, all five native species in four seasons, reduced winter foliage, changed native wind with static original fixtures, and synchronous owning-tree picking. Ground-only browser captures also check material/opacity-independent shadow footprints at four sun angles, including native trees in a standard LightingEffect host. The old shader fails this regression; the fixed shader passes. Geometry, trunk join and crop/cache/update-trigger tests check independent source contracts. PR #794 also verified the former compatibility export with an exact-constructor identity test; the stacked package-removal PR deletes that export and test.

Actual non-fallback WebGPU rendering and wind were separately inspected in the hardware browser. Headless WebGPU cases skip when no adapter exists. deck.gl shadows are WebGL-only. Async picking readback, automated encoder error/concurrency recovery, numerical shader normals and cross-device performance remain unverified. Manual film capture is separate from those automated test lanes.

Reproduce with the commands and matched benchmark entries in [README](README.md).

## 10K / 20K forest

`forest.html` and the website Tree Forest example use deterministic procedural positions, varied dimensions and all five species. The count controls allocate exactly 10,000 or 20,000 rows. Wind, shadows, seasons and sunlight are independent; the default flyover inspects crowns, while overview fits the full dataset. Browser checks render both counts, every season and shadow state, preserve default flyover during initialization and project the overview corners inside the viewport.

[Retained scale samples](forest-review.json) record source/build fingerprints, exact instance counts and the camera shared with the live canopy view. One production WebGL2 renderer ran at a time on Apple M4 Pro/ANGLE Metal, at 1236×680 and 1× pixels. Each workload used a two-second warmup followed by three five-second 90° camera orbits. Every retained sample started visible and focused and ended visible. No builds or automated rendering tests ran during measurement.

| Workload | 10,000 trees: median draws/s (range) | 20,000 trees: median draws/s (range) |
| --- | --- | --- |
| Original, high detail, static, shadows off | 98.0 (96.8–98.3) | 50.5 (44.7–52.7) |
| Native, high detail, static, shadows off | 119.8 (119.8–119.8) | 68.6 (65.1–74.1) |
| Native, medium detail, wind and shadows on | 72.3 (63.2–73.3) | 40.4 (39.1–44.5) |
| Native, medium detail, wind on, shadows off | — | 93.4 (92.8–93.6) |

The one-tree control before the matrix delivered 119.8–120.1 draws/s, with p95 delivery intervals of 9.1–9.3 ms. Native 10K static samples approach that browser scheduling limit. All retained workloads had zero rendering errors and zero recorded long tasks. For the medium-detail animated workload, p95 frame intervals ranged from 17.1–25.0 ms at 10K and 25.7–33.3 ms at 20K. Disabling shadows at 20K reduced that range to 17.0–17.1 ms while retaining wind and all tree instances.

These samples precede the final count-stability layout and reduced-motion default changes; their source/build fingerprints identify the measured version. The mesh renderer and detail budgets are unchanged. These are submitted draw rates and browser delivery intervals, not GPU execution time or proof of presentation. The raw report also includes synchronous render-call wall time; this measures CPU/driver submission, not GPU elapsed time. The original has no wind feature, so animated native results are not a matched speedup comparison. The current visual tour always uses the former high-detail meshes; medium-detail timings do not describe its workload.

The earlier provisional matrix is retained in Git history at `7134bcf916be37faab029d76231e60cc768755d4`; it used a different camera and a scheduling-limited host and must not be combined with these samples. The browser approval service became unavailable before an ending control, low-detail result, winter performance sample or overview performance sample could be saved. Automated rendering checks cover every season at 20K; those checks establish rendering behavior, not seasonal performance. No mobile, peak-throughput or cross-device performance claim is made.

### High-pitch shadows

Screen-corner ground intersections flipped behind the camera above the horizon, making local shadows disappear at 71.5°. The shared Tree Lab lighting now bounds forward rays, includes the 0–32m crown slab and rejects out-of-volume samples with a soft boundary. A physical 2cm receiver bias preserves branch shadows as the light volume grows. Projection work is shared across layers; no extra shadow pass is added. A WebGL pixel regression checks local shadow coverage and absence of distant phantom shadows at nine pitches from 58° to 80°, including the exact horizon, all four seasons and two sun directions, with a fixed wind pose. The prior implementation fails that regression. The 20K forest also renders shadows on/off at 80° through its visible pitch control. This is an example lighting fix; an ordinary upstream LightingEffect retains its own frustum fitting.


### Softer ground shadows and native comparison maps

The lab now uses depth-only maps with hardware comparison filtering. A fixed 1024-pixel longest axis caps shadow work independently of display DPR; the depth pass skips material shading. Tree surfaces use four hardware PCF reads. Flat ground uses one lookup into a half-resolution coverage mask, blurred in two reusable passes per light. A 45cm Gaussian scale blends narrow leaflet gaps and softens edges while preserving larger openings. This optimization is specific to the lab's plane at -2cm.

Matched single-renderer camera-orbit samples on Apple M4 Pro / ANGLE Metal, 1236×680 at 1×, with wind and shadows on:

| Workload | Previous filter, draws/s | Updated filter, draws/s |
| --- | --- | --- |
| 10K, medium | 36.3–37.8 | 76.5–80.8 |
| 20K, medium (final shader) | 29.7–31.6 | 43.4–49.1 |
| 20K, high | 23.4–24.2 | 40.2–41.5 |

Each run includes a warmup and three five-second orbits; medium detail includes three updated runs to check timing variation. Inactive comparison renderers were unloaded and forest animations paused. All retained samples report zero rendering errors and long tasks. These are browser draw delivery and frame intervals, not GPU execution time; the shared machine varied between runs. The 10K medium and 20K high updated-filter rows precede the final fragment-hook correction that skips material shading in the depth pass. The 20K medium row reports only the corrected-shader samples; earlier measurements are retained in the raw report. A final matched 20K medium check with that correction delivered 43.4–49.1 draws/s and p95 intervals of 25.5–40.7ms, with no errors or long tasks. The map budget and receiving filters were unchanged. The assembled production shader is checked by the browser regression. Fourteen browser checks include narrow-gap blending, preserved large openings, fractional leaf coverage, resized texture replacement, shadow toggles, and palm/oak shadows at nine pitches through the horizon in every season and two sun directions. See the [matched shadow comparison](../../../website/static/videos/tree-lab-shadows.png) and [retained shadow measurements](shadow-review.json).
