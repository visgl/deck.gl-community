import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# FullScreenPanelWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="full-screen-panel-widget" />

`FullScreenPanelWidget` renders a large inset panel over the deck overlay.

## Import

```ts
import {FullScreenPanelWidget} from '@deck.gl-community/widgets';
```

## Props

```ts
type FullScreenPanelWidgetProps = WidgetProps & {
  container?: WidgetContainer;
  panel?: WidgetPanel;
  placement?: WidgetPlacement;
  title?: string;
  marginPx?: number;
};
```


## Usage

Use `FullScreenPanelWidget` when you want one focused panel layout to occupy most of the visualization while preserving canvas context around the edges.

## Remarks

- Uses deck.gl's `fill` widget placement by default.
- Accepts either a full `container` description or a single `panel`.
- Insets itself from the overlay edge with `marginPx`, leaving a visible border around the panel.
- Stops pointer, mouse, touch, and wheel propagation so interactions do not leak into the deck canvas.
