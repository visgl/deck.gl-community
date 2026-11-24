---
title: EdgeMarkerLayer
---

# EdgeMarkerLayer

![From v10.0.0-alpha.5](https://img.shields.io/badge/from-v10.0.0--alpha.5-green.svg?style=flat-square)
![Experimental](https://img.shields.io/badge/stability-experimental-orange.svg?style=flat-square)

`EdgeMarkerLayer` is an experimental screen-space layer for MapView, GlobeView,
and FirstPersonView. It draws a ring at each target inside the viewport margins.
It docks an arrow at the margin edge for each target outside the margins, behind
the camera, or beyond the globe horizon. The arrow points toward the target.

[Open the interactive example](/examples/layers/edge-markers).

## Usage

```ts
import {EdgeMarkerLayer} from '@deck.gl-community/layers/common-layers';

const layer = new EdgeMarkerLayer({
  id: 'edge-markers',
  data: [
    {position: [-122.42, 37.77, 30] as const, label: 'T-001'},
    {position: [-122.6, 37.9, 120] as const, label: 'T-002'}
  ],
  getPosition: target => target.position,
  getLabel: target => target.label,
  getColor: [111, 221, 255, 255],
  margins: 32,
  pickable: true
});
```

## Properties

This layer accepts the common deck.gl layer properties and the options below.

### `data` (`LayerDataSource<DataT>`, required) {/* #data */}

Provides one object per target. The base layer defaults to `[]`.

### `getPosition` (`Accessor<DataT, Position>`, optional) {/* #getposition */}

Returns a target position in the coordinates of the view. Defaults to `d => d.position`.

### `getColor` (`Accessor<DataT, Color>`, optional) {/* #getcolor */}

Sets the color of each marker. Defaults to `[255, 255, 255, 255]`.

### `getLabel` (`AccessorFunction<DataT, string> | null`, optional) {/* #getlabel */}

Returns the text above or below a marker. Defaults to `null`, which hides labels.

### `margins` (`number | Partial<EdgeMarkerMargins>`, optional) {/* #margins */}

Insets the docking rectangle in CSS pixels. Pass a number for all edges or an
object with `top`, `right`, `bottom`, and `left`. Each edge defaults to `24`.

### `minDistance` (`number`, optional) {/* #mindistance */}

Hides targets closer than this distance in meters. Defaults to `0`.

### `maxDistance` (`number`, optional) {/* #maxdistance */}

Hides targets farther than this distance in meters. Defaults to `Infinity`.

### `yStretch` (`number`, optional) {/* #ystretch */}

Scales the vertical component of the docking ray. Defaults to `1`.

### `integerCoordinates` (`boolean`, optional) {/* #integercoordinates */}

Rounds marker positions to whole device pixels. Defaults to `true`.

### `devicePixelRatio` (`number | null`, optional) {/* #devicepixelratio */}

Sets the number of device pixels per CSS pixel for rounding. Defaults to `null`,
which uses the canvas pixel ratio.

### `behindCamera` (`'dock' | 'hide'`, optional) {/* #behindcamera */}

Sets how the layer treats targets behind the camera plane. Defaults to `'dock'`.

### `beyondHorizon` (`'dock' | 'hide' | 'ignore'`, optional) {/* #beyondhorizon */}

Sets how the layer treats targets that the globe hides. Defaults to `'dock'`.
Use `'ignore'` to skip the horizon test and apply the usual screen bounds.
This property applies only to GlobeView.

### `showOnScreen` (`boolean`, optional) {/* #showonscreen */}

Draws markers and labels for targets inside the margins. Defaults to `true`.

### `iconAtlas` (`string`, optional) {/* #iconatlas */}

Sets the URL of the icon atlas. The default is an embedded atlas with a
right-pointing arrow and a ring.

### `iconMapping` (`Record<string, {x: number; y: number; width: number; height: number; mask?: boolean}>`, optional) {/* #iconmapping */}

Maps icon names to rectangles in the atlas. The default maps `arrow` to
`{x: 0, y: 0, width: 64, height: 64, mask: true}` and `ring` to
`{x: 64, y: 0, width: 64, height: 64, mask: true}`.

### `edgeIcon` (`string`, optional) {/* #edgeicon */}

Names the docked icon. Use an icon that points right. Defaults to `'arrow'`.

### `onScreenIcon` (`string`, optional) {/* #onscreenicon */}

Names the icon for targets inside the margins. Defaults to `'ring'`.

### `edgeIconSize` (`number`, optional) {/* #edgeiconsize */}

Sets the docked icon size in CSS pixels. Defaults to `28`.

### `onScreenIconSize` (`number`, optional) {/* #onscreeniconsize */}

Sets the on-screen icon size in CSS pixels. Defaults to `22`.

### `fontSize` (`number`, optional) {/* #fontsize */}

Sets the label size in CSS pixels. Defaults to `13`.

### `fontFamily` (`string`, optional) {/* #fontfamily */}

Sets the label font family. Defaults to `'Monaco, monospace'`.

### `labelColor` (`Color`, optional) {/* #labelcolor */}

Sets the color of all labels. Defaults to `[255, 255, 255, 255]`.

## Marker placement

`EdgeMarkerState` defines four placement states and one hidden state.

| State | Placement |
| --- | --- |
| `ON_SCREEN` | The ring sits at the projected target inside the margins. |
| `OFF_SCREEN` | The arrow docks when the projected target lies outside the margins. |
| `BEHIND_CAMERA` | The arrow docks on the side of the target behind the camera plane. |
| `BEYOND_HORIZON` | The arrow docks when the globe obscures a target in front of the camera plane. |
| `HIDDEN` | A distance filter or the camera or horizon policy hides the target. |

The docking ray starts at the principal point, where the camera axis projects
onto the screen. It meets the edge of the margin rectangle. If the principal
point lies outside the rectangle, the layer clamps the ray origin to the rectangle.
The arrow angle follows the true screen bearing from the homogeneous coordinates
`(X - cx * W, Y - cy * W)`, where `(cx, cy)` is the principal point. This
direction stays valid behind the camera, where a plain perspective divide mirrors
the point.

When `integerCoordinates` is on, the layer aligns the docking rectangle to the
device pixel grid and rounds marker positions to whole device pixels. Increase
`yStretch` for a game-style layout with docked markers farther from the
horizontal center line. The arrow keeps its original bearing. A value of `1`
preserves the original docking ray.

The layer measures camera-to-target distance in meters. MapView and
FirstPersonView approximate this distance using the scale at the viewport center.

## GlobeView: behind the camera vs beyond the horizon

A target is behind the camera when its clip coordinate `w <= 0`. It lies behind
or on the camera plane. `behindCamera` controls this case in all views.

A target is beyond the globe horizon when it lies in front of the camera plane
and the segment from the camera to the target enters the sea-level globe sphere
before reaching the target. `beyondHorizon` controls this case in GlobeView.

## Screen-space drawing

The icon and text sublayers share one anchor on the camera axis just in front of
the focal plane. They draw each marker with a pixel offset from that anchor.
They refresh their attributes in the same frame as a viewport change. Picking
returns the original target object when `pickable` is enabled.

Use each layer instance in one view. The layer estimates label width from the
character count. CPU placement cost grows linearly with the number of targets.

## `computeEdgeMarkers(viewport, positions, count, options, out?)` {/* #computeedgemarkers */}

This utility computes marker placement on the CPU and returns an `EdgeMarkerFrame`.
Pass target positions as a flat sequence `[x0, y0, z0, x1, y1, z1, ...]` in the
viewport's world coordinates. `count` specifies how many targets to read.
Pass an `EdgeMarkerOptions` object or start from `DEFAULT_EDGE_MARKER_OPTIONS`.
The utility takes a full margin object and a numeric pixel ratio. Its default
options use a ratio of `1`.

Pass an existing frame as `out` to reuse its arrays when they have enough
capacity. Pass a new input array when target positions change. Read only the first
`count` entries in each per-target array. `positions` uses two entries per target.
Skip positions for targets with state `HIDDEN`.

| Field | Type | Meaning |
| --- | --- | --- |
| `count` | `number` | Number of active targets. |
| `positions` | `Float64Array` | Interleaved `[x, y]` positions in CSS pixels from the top-left corner. |
| `angles` | `Float32Array` | Arrow angles in degrees, counterclockwise from screen right. On-screen angles are `0`. |
| `states` | `Uint8Array` | One `EdgeMarkerState` value per target. |
| `distances` | `Float64Array` | Camera-to-target distances in meters. |
| `principalPoint` | `[number, number]` | Projection of the camera axis in CSS pixels. |
| `anchor` | `[number, number, number]` | Position on the camera axis in the viewport's world coordinates. |
| `pixelScale` | `number` | Multiplier for screen-space offsets and sizes drawn at the anchor. |
| `projectionCache` | `EdgeMarkerProjectionCache \| null` | Internal cache of projected positions. |
