# Tree Lab

Run `yarn workspace @deck.gl-community/tree-lab-example start` from the repository root. Every species has a synchronized original/native pair. Seasons, attached and dropped crops, optional WebGL shadows, detail and wind are independently controlled. The resolution control compares a fast 1× render with a sharp 2× render; performance entries always use 1×. Live wind pauses for offscreen specimens and hidden documents. The time slider freezes repeatable poses. The original fixture is frozen from master c8b25275 (9.4.2).

Native wind runs in the vertex shader on both WebGL and WebGPU. The original renderer has no wind feature and is labelled static. Set `?backend=webgpu` to inspect that backend; shadows are disabled because deck.gl's shadow effect remains WebGL-only.

For comparable performance, use `native.html` and `baseline.html` with identical `count`, `species`, `detail`, `crops`, `shadows` and `wind` query parameters. Each page runs one renderer. Warm the scene, run three 5-second camera orbits, and compare median/p95 frame delivery, long tasks and actual backend/device. Do not infer GPU timings or real-device speed from browser frame intervals. `wind=1` cannot be an equivalent workload because the original has no animation.

`yarn workspace @deck.gl-community/tree-lab-example build` creates production benchmark entries. The native entry never loads the development-only Three.js fixture. Images and measurements in the review report identify the build, viewport and actual renderer.

The default Auto tour moves the sunlight through a full rotation and cycles spring, summer, autumn and winter every 32 seconds. Manual season or sun-angle controls pause the tour; reduced-motion preferences start with the tour off. Shadow toggles retain the trees while switching the matched lighting effect.

Open `film.html` for a 1920×1080 side-by-side tour. Each species gets 12 seconds and visits every season while the sun and camera move. Record a four-second proof before the full 60-second capture. A fixed 30 fps clock drives both renderers; each requested frame waits for both GPU draws before capture. WebCodecs encodes every requested frame with integer presentation timestamps; the download is VP9/IVF. Convert it with `ffmpeg -i tree-lab-60s.ivf -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart tree-lab-60s.mp4` and verify before sharing. Slow rendering increases export time without dropping seasonal stages.

See [review evidence](REVIEW.md) for the film, seasonal contact sheet, measured geometry budgets and qualified performance samples.
