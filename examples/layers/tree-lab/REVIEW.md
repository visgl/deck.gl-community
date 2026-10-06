# Tree Lab review evidence

[Watch the 60-second comparison](../../../website/static/videos/tree-lab-native.mp4) or inspect [all 20 seasonal stages](../../../website/static/videos/tree-lab-seasons.jpg). The website Tree Lab page embeds the film above the interactive comparison. Original geometry is frozen from master c8b25275 (9.4.2). Both columns share camera, light, dimensions and supplied crop configuration; the original has no wind and is labelled static.

The film includes pine, oak, palm, birch and cherry, with 12 seconds per species and three seconds per season. Sunlight rotates, shadows move, and native trunks, crowns and attached crops bend. The final download contains exactly 1,800 paired and encoded frames with zero application rendering errors. Converted H.264 output is 1920×1080 at 30 fps for 60 seconds; a full decode and presentation timestamp check passed. All 20 tree/season combinations were inspected in the contact sheet. Film SHA-256: `ea1be891121cd12ca31eeca95eb77b9a1e2bc368f3643ed30c4f9fc333c74d4a`.

The refreshed film corrects hollow shadow interiors: packed depth is written after mesh lighting and opacity, and both comparison columns use the same corrected depth output. Winter leaders meet the trunk at its physical top radius without the former independent pitch, then smoothly taper into the branch structure. Cached mesh rings and an instance radius keep the join dimension-aware without per-tree mesh allocation.

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

`forest.html` and the website Tree Forest example use deterministic procedural positions, varied dimensions and all five species. The count controls allocate exactly 10,000 or 20,000 rows. Wind, shadows, detail, seasons and sunlight are independent; the default flyover inspects crowns, while overview fits the full dataset. Browser checks render both counts, every season and shadow state, preserve default flyover during initialization and project the overview corners inside the viewport.

[Retained scale samples](forest-review.json) record source/build fingerprints, exact instance counts and the camera shared with the live canopy view. One production WebGL2 renderer ran at a time on Apple M4 Pro/ANGLE Metal, at 1236×680 and 1× pixels. Each workload used a two-second warmup followed by three five-second 90° camera orbits. Every retained sample started visible and focused and ended visible. No builds or automated rendering tests ran during measurement.

| Workload | 10,000 trees: median draws/s (range) | 20,000 trees: median draws/s (range) |
| --- | --- | --- |
| Original, high detail, static, shadows off | 98.0 (96.8–98.3) | 50.5 (44.7–52.7) |
| Native, high detail, static, shadows off | 119.8 (119.8–119.8) | 68.6 (65.1–74.1) |
| Native, medium detail, wind and shadows on | 72.3 (63.2–73.3) | 40.4 (39.1–44.5) |
| Native, medium detail, wind on, shadows off | — | 93.4 (92.8–93.6) |

The one-tree control before the matrix delivered 119.8–120.1 draws/s, with p95 delivery intervals of 9.1–9.3 ms. Native 10K static samples approach that browser scheduling limit. All retained workloads had zero rendering errors and zero recorded long tasks. For the medium-detail animated workload, p95 frame intervals ranged from 17.1–25.0 ms at 10K and 25.7–33.3 ms at 20K. Disabling shadows at 20K reduced that range to 17.0–17.1 ms while retaining wind and all tree instances.

These samples precede the final count-stability layout and reduced-motion default changes; their source/build fingerprints identify the measured version. The mesh renderer and detail budgets are unchanged. These are submitted draw rates and browser delivery intervals, not GPU execution time or proof of presentation. The raw report also includes synchronous render-call wall time; this measures CPU/driver submission, not GPU elapsed time. The original has no wind feature, so animated native results are not a matched speedup comparison. Keep medium detail for the visual tour, use shadows off when frame pacing matters more, and use high detail for close inspection.

The earlier provisional matrix is retained in Git history at `7134bcf916be37faab029d76231e60cc768755d4`; it used a different camera and a scheduling-limited host and must not be combined with these samples. The browser approval service became unavailable before an ending control, low-detail result, winter performance sample or overview performance sample could be saved. Automated rendering checks cover every season at 20K; those checks establish rendering behavior, not seasonal performance. No mobile, peak-throughput or cross-device performance claim is made.
