# VolumetricVideoLayer

Renders an MP4 or MOV as a volume of Gaussian splats. Each video frame becomes an XY
plane; earlier frames extend along local -Z. `currentFrame` selects the end of the
volume and `frameTrail` includes the preceding frames. This is an image-X/image-Y/time
volume, not a reconstructed 3D scene.

```typescript
import {VolumetricVideoLayer} from '@deck.gl-community/layers';

const layer = new VolumetricVideoLayer({
  id: 'video-volume',
  video: file, // File, Blob, or a CORS-enabled MP4/MOV URL
  currentFrame: 90,
  frameTrail: 32,
  frameSpacing: 0.025,
  resolution: 0, // native source pixels (the default)
  onVideoLoad: info => console.log(info.frameCount, info.frameTimestamps)
});
```

Use an `OrbitView` to explore the volume. The layer defaults to Cartesian coordinates.
`position`, `coordinateSystem`, `coordinateOrigin`, `modelMatrix`, and `opacity` use
the standard deck.gl layer conventions.

## Properties

| Property | Default | Description |
| --- | --- | --- |
| `video` | `null` | MP4/MOV URL, `File`, or `Blob`. Local files stay in the browser. |
| `currentFrame` | `0` | Zero-based source frame index in presentation order, clamped to the video. |
| `frameTrail` | `24` | Number of preceding frames; `0` displays only the selected frame. The trail stops at frame 0. |
| `maxFrameTrail` | `null` | Automatically grows history to the requested trail, up to the video length. An explicit value reserves and limits history. There is no fixed 64/255-frame software cap; GPU array-layer and memory limits still apply. |
| `resolution` | `0` | Maximum sampling dimension, up to the device texture limit. `0` retains every source pixel. Preserves the video's display aspect ratio; one texel is one splat. |
| `renderMode` | `'auto'` | Uses one plane per frame with per-fragment Gaussian evaluation for Cartesian coordinates, no extensions, and `splatSize < 2`. Otherwise falls back to classic instanced per-pixel Gaussian quads. `'instanced'` forces that point renderer. |
| `maxTextureBytes` | `536870912` | Byte budget for raw color, change history, and the filtered mip pyramid (512 MiB). An oversized request reports an error and retains the previous cache. |
| `width` | `2` | Width of each video plane in layer coordinates. |
| `position` | `[0, 0, 0]` | Center of the current frame's plane. |
| `frameSpacing` | `0.025` | Distance between successive planes along -Z; `0` overlays them. |
| `splatSize` | `1` | Gaussian footprint diameter in sampling-grid cells. |
| `frameOpacity` | `0.35` | Per-frame alpha multiplier applied after normalized filtering. In auto mode, `1` preserves the visible source alpha and brightness. |
| `trailFade` | `0.025` | Fractional opacity decay per preceding frame: `(1 - trailFade) ** age`. |
| `luminanceThreshold` | `0` | Discards texels darker than this 0–1 threshold. Useful for dark-background motion studies. |
| `staticPixelRemoval` | `0` | Per-pixel removal strength. `0` shows all pixels; `1` aggressively hides similar pixels. Positive values require an RGBA channel change greater than `0.5 * strength ** 2`. Frame 0 is retained as the baseline. |
| `onVideoLoad` | `null` | Receives display `width`, `height`, `duration`, `frameCount`, and actual `frameTimestamps` in seconds. |
| `onFrameLoad` | `null` | Receives the GPU-resident `firstFrame`, `currentFrame`, `frameCount`, source `timestamp`, `splatCount` before visibility filtering, and combined history `textureBytes`. |

Errors use deck.gl's `onError` callback. Changing frames, moving backwards, and
replacing the source all work without retaining the entire decoded video. Rapid
scrubbing uses the latest request; `onFrameLoad` indicates completion. A previous
resident window remains visible while a resized replacement cache allocates,
decodes, and prepares its visibility pyramid. The layer swaps caches only after
that work succeeds, then destroys the old cache. Failed allocation or preparation
cleans partial resources and preserves the completed volume. An overwritten ring
slot is never displayed under the wrong frame index.

## GPU and decoding

[Mediabunny](https://mediabunny.dev/guide/media-sinks) demuxes the file, indexes source
presentation timestamps, and manages WebCodecs decoding. This includes B-frame
presentation ordering and variable frame rates. Negative-timestamp preroll packets
are excluded from the frame index. MP4 and MOV are containers: the contained codec
must be decodable by the browser. Unsupported codecs report an error rather than
silently substituting frames. Try H.264 for portable examples.

luma.gl owns the texture-array ring, upload texture, framebuffers, GPU resizing and
orientation correction, and rendering. JavaScript never reads video pixels
back or creates a per-pixel object array. Display rotation and mirroring are applied
in a GPU resampling pass. The default Cartesian path submits one quad per frame. Its fragment shader finds
neighboring source pixels and evaluates normalized Gaussian weights when individual
pixels are large enough to resolve. When several source pixels fit in a fragment,
it samples a premultiplied, visibility-masked mip pyramid generated by luma on the GPU.
Normalized filtering preserves source brightness instead of multiplying it by a
camera-dependent Gaussian coverage factor. `frameOpacity` then sets frame alpha. This keeps the full sampling
grid in textures while eliminating four vertex executions per pixel per frame.
Static-pixel filtering skips color fetches for removed pixels. The classic per-pixel
`renderMode: 'instanced'` path remains available, including automatic fallback for
extensions, non-Cartesian coordinates, and larger splat footprints.

The **Remove static pixels** slider controls `staticPixelRemoval`. luma compares
individual pixels in consecutive, orientation-corrected frames at the sampling
resolution. The per-pixel score is the largest absolute RGBA channel difference.
At `0`, every pixel splat is shown. Increasing removal strength hides both unchanged
pixels and pixels whose color changes only slightly. The threshold is
`0.5 * staticPixelRemoval ** 2`: at `0.5`, the largest channel difference must exceed
12.5%; at `1`, it must exceed 50%. The upper end aggressively removes similar pixels
while preserving strong changes. The curved scale gives finer control near the low
end. Any positive setting removes exactly unchanged pixels, even when a neighboring
pixel moves. Frame 0 is retained as the baseline because it has no predecessor.

The comparison includes the source predecessor outside the visible trail, so
scrubbing direction does not change the result. Pixel splats retain their original
time positions. Adjusting removal strength rebuilds the resident GPU visibility mask and mip levels
from the already-decoded frames and change scores. It does not re-decode the video
or compare pixels on the CPU. Opacity and camera changes reuse this pyramid. Increasing `resolution` captures
smaller spatial details. Camera shake and compression noise count as color changes.

Raw RGBA and change history use 8 bytes per grid pixel per retained frame. The
filtered RGBA mip pyramid adds about 5.33 bytes per pixel per frame (the exact
amount depends on rounded mip dimensions). Exported `getVolumetricVideoHistoryBytes(
gridWidth, gridHeight, retainedFrameCount)` returns the exact combined allocation. `textureBytes` reports their
combined allocation. The native-size upload texture, one sampled reference frame,
and the decoder require additional memory. A resized cache temporarily coexists with
the completed cache until it can replace it, so transitions need memory for both
histories. History stays
bounded by the requested trail rather than video duration. Native pixels are retained
by default. Shorten the trail or increase `maxTextureBytes` if the requested history
exceeds its budget. Requests above the device's actual texture-array layer limit
report an error and keep the previous cache.
The layer does not silently lower the requested sampling grid to fit the budget.
The allocation check includes all retained history textures; it does not guarantee that
the decoder and other applications have enough free GPU memory. Source changes and layer finalization release
the input, decoder, GPU textures, framebuffers, and models.

## Performance

Camera movement reuses resident textures without decoding or uploading frames.
The cached GPU visibility pyramid also stays unchanged during camera movement.
The demo holds playback at the same source frame while dragging, zooming, or settling
the damped camera, then resumes without jumping ahead. Its framebuffer uses one
pixel per CSS pixel to avoid Retina's fourfold fill workload; source sampling
resolution remains independent of that display setting.
For the default path, geometry work scales with the number of frame planes,
rather than source pixels multiplied by the trail. Fragment work still depends on
visible screen coverage, overlapping frames, and the splat footprint. Native pixels
also increase texture memory, upload, and decoding costs. An arbitrarily long trail
or arbitrarily large source cannot have constant cost on finite hardware.

The demo defaults to **Every source pixel** whenever a file is opened. Its trail
slider reaches `frameCount - 1`, which includes the entire video when the last frame
is selected and the chosen sampling grid fits. The initial trail fits the default
512 MiB history budget. The demo limits its budget to 1024 MiB to avoid unstable
multi-GiB allocations; this is a conservative demo policy, not a hardware-memory
measurement. **Appearance and history** exposes that budget, and the panel shows
the memory needed for the full video at the chosen sampling grid. A request larger
than the budget or device array-layer limit is clamped before allocation, without
reducing source resolution. A visible message reports the effective trail and the
requested trail. The demo retains the request so choosing lower sampling can extend
the trail to its intended length. Allocation failures still keep the previous volume. The opt-in browser benchmark compares the reference and
automatic paths using identical sparse and dense 640×360 synthetic videos, GPU
timestamps, and camera frame intervals. See the example README for the command.

Transparent splats disable depth writes by default so overlapping pixels do not
incorrectly occlude one another. Standard `parameters` overrides remain supported.

This implementation requires WebGL2 and browser video decoding. It does not provide
WebGPU shaders, per-splat picking, audio playback, HDR mastering, camera-motion
registration, or scene reconstruction. Transparency orders the parallel frame planes
for the active viewport. The demo's source video is a synthetic motion fixture.
