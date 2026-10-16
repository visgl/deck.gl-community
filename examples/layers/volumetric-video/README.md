# Volumetric video

An imperative `VolumetricVideoLayer` demo with `currentFrame`, `frameTrail`, frame
spacing, static-pixel removal strength, playback, orbit presets, and local MP4/MOV selection.

From the repository root:

```sh
yarn
yarn workspace @deck.gl-community/example-volumetric-video start-local
```

The bundled `sample.mp4` is a generated four-second, 30 fps H.264 motion study, not
captured footage. The small MOV test fixture is a remuxed excerpt of the same source.
No video is uploaded to a server. Decoding requires a browser-supported codec;
H.264 MP4/MOV is a useful portable starting point.

The public layer is documented in
`docs/modules/layers/api-reference/volumetric-video-layer.md`.

Remove static pixels: `0` shows all pixels; `1` aggressively removes similar pixels.
Each pixel is compared to the same coordinate in the preceding source frame on the
GPU. Increasing removal strength raises the tolerated RGBA difference, up to 50%
at the maximum. Only sufficiently changed pixel splats remain, at their original
time positions.


Sampling defaults to **Every source pixel** (`resolution: 0`) on every new video.
The trail slider reaches the full video length (`frameCount - 1` preceding frames).
Native history consumes about 13.33 bytes per source pixel per retained frame,
including the filtered mip pyramid, plus decoder/upload memory. The initial trail
fits the default 512 MiB budget. The panel shows full-video memory requirements,
and **Appearance and history** lets you increase the budget up to the demo's
conservative 1024 MiB ceiling. Oversized requests are limited before allocation;
the UI reports the effective and requested trail. Sampling stays unchanged. The
request is retained, so selecting lower sampling can restore the desired trail.
Replacement caches allocate, decode, and prepare their GPU filtering while the
completed volume stays visible. Only a successful replacement deletes the old
cache. Allocation failures clean partial resources and preserve the old volume.
During a replacement, both histories temporarily consume GPU memory.

The default renderer evaluates Gaussian splats on one plane per frame, instead of
submitting four vertices for each pixel. `renderMode: 'instanced'` retains the
classic per-pixel point renderer for custom extensions.

Run the opt-in benchmark from the repository root:

```sh
VITE_VOLUMETRIC_VIDEO_BENCHMARK=1 GITHUB_ACTIONS=true yarn test-headless modules/layers/test/volumetric-video-layer/performance.browser.spec.ts
```

`GITHUB_ACTIONS=true` selects installed Chrome using the repository's test config;
omit it when Playwright's Chromium is installed. The benchmark uses synthetic sparse
motion and dense FFmpeg `testsrc2` fixtures at 640×360, with a 1024×640 render target.
It measures both paths, discards four GPU warmups, reports ten GPU timestamp samples,
and measures 60 camera frame intervals after ten warmups. Performance results are
reported, not used as machine-dependent pass thresholds. These measurements do not
establish playback throughput or performance for a particular uploaded MOV.


Opacity is applied after normalized filtering in the automatic renderer. An opaque
source at opacity 1 keeps its brightness as the camera rotates or zooms. A cached,
premultiplied GPU mip pyramid filters source pixels and visibility together when
minified; camera and opacity changes never regenerate it. Visibility-slider changes
rebuild the pyramid from resident GPU data without decoding again.

The demo uses one framebuffer pixel per CSS pixel. This avoids a fourfold Retina
fill cost while retaining the selected source-pixel grid. Playback holds the current
video frame during camera interaction and damping, then resumes from that time.
Forward ring rollover retains a valid resident suffix instead of blanking the volume.

The opt-in benchmark also includes a generated native 1080×1920 portrait fixture,
19 retained frames, opacity 1, and the demo's 597×853 viewport. Run only that test with
`-t 'native portrait'`. It checks zero frame requests, decoding calls, or visibility
pyramid rebuilds over 60 completed camera frames after ten warmups. Its readback fence
is test-only; those intervals are not a measurement of displayed compositor FPS.
