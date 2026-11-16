---
title: RainLayer
---

# RainLayer

`RainLayer` draws falling streaks inside a world-space volume. It uses the same seeded distribution and explicit time on WebGL2 and WebGPU. Advance `time` from an animation clock or set it directly when seeking a recording.

```ts
import {RainLayer} from '@deck.gl-community/layers';

const layer = new RainLayer({
  id: 'rain',
  position: [-122.4194, 37.7749, 40],
  size: [240, 180, 80],
  velocity: [2, -1, -8.5],
  count: 4000,
  time: elapsedSeconds
});
```

This example centers rain 40 meters above the supplied longitude and latitude. Put the rain after opaque layers in Deck's layer array so their depth can occlude the streaks.

## Props

| Prop | Default | Description |
| --- | --- | --- |
| `position` | `[0, 0, 0]` | Center of the volume in the layer's coordinate system. |
| `size` | `[200, 200, 80]` | Positive width, depth, and height in meters. |
| `velocity` | `[0, 0, -8.5]` | Local x, y, and z velocity in meters per second. Geospatial axes are east, north, and up. |
| `count` | `2048` | Number of drops. Set to zero to clear the rain. |
| `time` | `0` | Elapsed seconds, set by the application. |
| `exposure` | `1 / 60` | Exposure in seconds. The layer multiplies speed by exposure to determine streak length. |
| `streakWidth` | `1.5` | Streak width in CSS pixels. |
| `color` | `[200, 220, 235, 128]` | RGB or RGBA byte values. |
| `seed` | `0` | Unsigned 32-bit seed for the initial positions. |

Drops fade at the volume boundary and wrap to the opposite side. The layer depth-tests the streaks, and leaves depth and shadow maps untouched. Individual drops have no picking IDs.
