import WidgetPanelsLiveExample from '@site/src/components/docs/widget-panels-live-example';

# FullScreenPanelWidget

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

<WidgetPanelsLiveExample highlight="full-screen-panel-widget" />

`FullScreenPanelWidget` renders a large inset panel over the deck overlay.

## Usage

```ts
import {ColumnPanel, MarkdownPanel} from '@deck.gl-community/panels';
import {FullScreenPanelWidget} from '@deck.gl-community/widgets';

const detailPanel = new ColumnPanel({
  id: 'details',
  title: 'Details',
  panels: {
    summary: new MarkdownPanel({
      id: 'summary',
      title: 'Summary',
      markdown: 'A focused panel layout that fills most of the viewport.'
    })
  }
});

const widget = new FullScreenPanelWidget({
  id: 'details-widget',
  panel: detailPanel
});
```

Use `FullScreenPanelWidget` when you want one focused panel layout to occupy most of the visualization while preserving canvas context around the edges.

Import panel definitions from `@deck.gl-community/panels` and pass them to
`FullScreenPanelWidget` through `panel` or `container`.

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

## Remarks

- Uses deck.gl's `fill` widget placement by default.
- Accepts either a full panel `container` description or a single `panel`.
- Insets itself from the overlay edge with `marginPx`, leaving a visible border around the panel.
- Stops pointer, mouse, touch, and wheel propagation so interactions do not leak into the deck canvas.
