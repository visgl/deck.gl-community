# FlameTrailLayer

An interactive, synthetic circuit comparing FlameTrailLayer with TripsLayer over
rugged terrain or flat ground. No API keys or external data are required.

From the repository root:

```sh
yarn
yarn workspace @deck.gl-community/example-flame-trail start-local
```

Use the controls to scrub/pause playback, adjust width and trail length, change
the RGB tint, and turn trail fading off. Drag to orbit around the raised volume
and inspect its hotter leading head. The layer needs only the normal TripsLayer
props; its width also controls flame height.

The demo starts with a stationary trip and an animated flame. Play trip and
Animate flame are independent toggles in the standard `SettingsPanel` /
`BoxPanelWidget`. Scrubbing pauses only the trip; turning off Animate flame
holds `flameTime` steady. Reduced-motion preferences start both clocks paused.

Use the same panel for the layer comparison, terrain fitting, tint, width, trail,
and mesh controls.
Hide UI (or H) removes the controls; Escape restores them.

The terrain scene has two peaks, a saddle, and fine ridges. The input route is
2D: TerrainExtension supplies a GPU height map, and FlameTrailLayer samples each
slice's footprint before adding the flame's height. Use Follow surface to compare
against the unfitted path, Low angle to inspect ground contact and occlusion,
and Show grid / mesh to inspect the triangles. Terrain fitting uses `offset`
mode to preserve the flame volume; texture-only `drape` mode flattens it.

Record 12s renders a clean 1920 × 1080 scene at a target of 30 fps and downloads
an MP4 when the browser supports it, with WebM as a fallback. It uses your camera
angles and flame settings, fits the circuit to the output frame, and advances
according to Play trip, Animate flame, and Trip speed. Slow camera orbit is optional. UI, cursor,
and audio are excluded. Everything stays in the browser; nothing is uploaded.
