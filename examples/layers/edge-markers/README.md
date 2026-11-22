# EdgeMarkerLayer

Moving targets appear as rings inside the margins. Arrows point toward targets
outside the margins, behind the camera, or beyond the globe horizon. Faint dots
show the visible target positions in the map and globe views.

Run these commands from the repository root.

```sh
yarn
yarn workspace @deck.gl-community/example-edge-markers start-local
```

Choose Map, Globe, or First person in the settings panel. Drag to move the camera.
Turn on **Slow auto pan** to rotate the bearing by two degrees per second. The
right end of **Max distance** means infinite range. The readout shows the target
count, placement states, and time spent computing markers on the CPU.

Use these URL parameters to set up a reproducible scene.

| Parameter | Values |
| --- | --- |
| `view` | `map` (default), `globe`, `first-person` |
| `count` | `10`–`10000`, default `200` |
| `labels` | `0` (default), `1` |
| `autopan` | `0` (default), `1` |
| `freeze` | `0` (default), `1` keeps the targets still, so only the camera moves. |
| `bench` | `1` exposes `window.__edgeMarkersBench` with `deck`, `getLayer()`, `setView(view)`, and `setCount(n)`. |
