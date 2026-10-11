# BasemapLayer / MapLibre split view

Run `yarn workspace basemap-layers-split-view-example start-local` from the repository root.

The left pane renders an OpenFreeMap vector style with `BasemapLayer`; the right
pane renders the same style with MapLibre GL JS. Pan, zoom, rotate, or tilt either
pane to synchronize both cameras. The style selector updates both renderers.
Rendering differences expose the basemap module's current style support.

No API key is required. The mount function returns cleanup for both renderers,
DOM listeners, and resize observation.

Choose Map, Globe, or First Person. First-person cameras share geographic position,
altitude, bearing, and orientation; drag to look and use WASD / arrow keys or scroll
to move. MapLibre is removed when the camera looks less than five degrees below
the horizon and recreated when the angle is supported again.

MapLibre 6 loads its pinned module worker from unpkg; tiles and styles come from
OpenFreeMap. Both services need network access.
