# FlameTrailLayer

An interactive, synthetic circuit comparing FlameTrailLayer with TripsLayer over
rugged terrain or flat ground. No API keys or external data are required.

From the repository root:

```sh
yarn
yarn workspace @deck.gl-community/example-flame-trail start-local
```

Use the standard WebGL2 / WebGPU tabs to switch real rendering devices.
Use the controls to scrub/pause playback, adjust width and trail length, change
the RGB tint, and turn trail fading off. Drag to orbit around the raised volume
and inspect its hotter leading head. The layer needs only the normal TripsLayer
props; its width also controls flame height.

The demo starts with a stationary trip and an automatically animated flame.
Play trip and scrubbing control route progress in the standard `SettingsPanel` /
`BoxPanelWidget`; the flame keeps burning. Reduced-motion preferences start
with the stationary TripsLayer view. Select FlameTrailLayer to enable fire.

Use the same panel for the layer comparison, terrain fitting, tint, width, trail,
and mesh controls.
Hide UI (or H) removes the controls; Escape restores them.

The terrain scene has two peaks, a saddle, and fine ridges. TerrainExtension
supplies a GPU height map; FlameTrailLayer samples each slice's footprint before
adding flame height. Use Follow surface to compare against the unfitted path,
Low angle to inspect ground contact and occlusion, and Show grid / mesh to
inspect the triangles. Fitting uses `offset` to preserve the flame volume.

WebGPU height maps require the unreleased
[upstream terrain port](https://github.com/visgl/deck.gl/pull/10751).
To preview that source on both backends:

```sh
DECK_GL_SOURCE=/path/to/deck.gl yarn workspace @deck.gl-community/example-flame-trail start-local
```

Without that override, WebGPU uses XYZ elevations sampled once from the mesh
triangles. The panel identifies which fitting path is active. Both paths render
raised flames, embers, and terrain occlusion; XYZ fitting follows the centerline
while the GPU height map also fits across the full flame footprint. WebGPU
texture `drape` mode is not supported.

Record 12s uses the selected backend and renders a clean 1920 × 1080 scene at a target of 30 fps and downloads
an MP4 when the browser supports it, with WebM as a fallback. It uses your camera
angles and flame settings, fits the circuit to the output frame, and advances
according to Play trip and Trip speed, while the flame animates automatically.
Slow camera orbit is optional. UI, cursor, and audio are excluded. Everything
stays in the browser; nothing is uploaded.
