# YZoomWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`YZoomWidget` is a vertical zoom control for orthographic trace views.

## Import

```ts
import {YZoomWidget} from '@deck.gl-community/widgets';
```

## Props

```ts
type YZoomWidgetProps = WidgetProps & {
  viewId?: string | null;
  targetViewId?: string | null;
  placement?: WidgetPlacement;
  minZoom?: number;
  maxZoom?: number;
  step?: number;
};
```

Default props:

- `id: 'y-zoom'`
- `placement: 'top-left'`
- `step: 0.1`


## Usage

Within the repo this widget is typically mounted next to reset/fullscreen controls for `DeckTraceGraph` and bound to the main orthographic trace view.

## Remarks

- Renders `-` and `+` buttons plus a vertical range slider.
- Tracks the Y zoom of the target orthographic view.
- Reads inferred zoom bounds from the current view state when explicit bounds are not supplied.
- Stops pointer, mouse, and wheel propagation so the slider interaction does not leak into deck pan/zoom handling.
- Applies changes only to the Y zoom axis, leaving X zoom behavior alone.
