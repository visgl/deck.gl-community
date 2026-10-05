# Tree Lab review evidence

[Watch the 60-second comparison](../../../website/static/videos/tree-lab-native.mp4) or inspect [all 20 seasonal stages](../../../website/static/videos/tree-lab-seasons.jpg). The website Tree Lab page embeds the film above the interactive comparison. Original geometry is frozen from master c8b25275 (9.4.2). Both columns share camera, light, dimensions and supplied crop configuration; the original has no wind and is labelled static.

The film includes pine, oak, palm, birch and cherry, with 12 seconds per species and three seconds per season. Sunlight rotates, shadows move, and native trunks, crowns and attached crops bend. The final download contains exactly 1,800 paired and encoded frames with zero application rendering errors. Converted H.264 output is 1920×1080 at 30 fps for 60 seconds; a full decode and presentation timestamp check passed. All 20 tree/season combinations were inspected in the contact sheet. Film SHA-256: `a3f5cd686e2b44701f0bc7ebd3078c7ecb022da339ca857a352dee72257295ff`.

## Geometry and performance

Native palm canopy triangles decrease from 4,448 to 1,760 at high detail, 1,224 at medium and 648 at low. Broadleaf high detail adds triangles to smooth the crown; low detail reduces them. Native geometry uses shared bounded CPU caches and instanced deck.gl meshes. Wind changes uniforms without regrouping trees or regenerating instance attributes. Production implementation chunks measure 101,543 bytes for the frozen original and 20,653 bytes for native; shared deck.gl/luma infrastructure is excluded.

[Raw retained samples and geometry budgets](review.json) record the actual device and workload. On one Apple M4 Pro through ANGLE Metal, with one production renderer at a time, three five-second 90° camera orbits at 1236×680 and 1× pixels delivered:

| Workload | Three median frame intervals | Three p95 frame intervals | Long tasks/errors |
| --- | --- | --- | --- |
| Original, 5,000 palms | 15.9 / 16.2 / 15.7 ms | 17.5 / 17.3 / 17.6 ms | 0 / 0 |
| Native high, 5,000 palms | 8.3 / 8.3 / 8.3 ms | 9.2 / 16.7 / 9.2 ms | 0 / 0 |
| Native high, 1,000 oaks + 44,000 crops + wind + filtered WebGL shadows | 8.3 / 8.3 / 8.3 ms | 9.1 / 9.1 / 9.3 ms | 0 / 0 |

These are browser delivery intervals, not GPU execution time or universal FPS claims. Earlier warm original palm medians varied down to 9.3 ms; oak medians were 8.3 ms for both renderers. Scheduling and system load matter. These samples precede the final picking, override and recorder correctness fixes. No mobile or physical-device performance claim is made.

## Verification boundaries

Root package/type/declaration build, Node tests, website build, Tree Lab typecheck/build and lint pass. The Tree Lab browser regression uses actual WebGL pixels to check all ten surfaces through shadows on → off → on, all five native species in four seasons, reduced winter foliage, changed native wind with static original fixtures, and synchronous owning-tree picking. Geometry and crop/cache/update-trigger tests check independent source contracts. PR #794 also verified the former compatibility export with an exact-constructor identity test; the stacked package-removal PR deletes that export and test.

Actual non-fallback WebGPU rendering and wind were separately inspected in the hardware browser. Headless WebGPU cases skip when no adapter exists. deck.gl shadows are WebGL-only. Async picking readback, automated encoder error/concurrency recovery, numerical shader normals and cross-device performance remain unverified. Manual film capture is separate from those automated test lanes.

Reproduce with the commands and matched benchmark entries in [README](README.md).
