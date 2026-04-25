# Overview

This package bundles widgets that integrate with deck.gl's built-in widget system. Widgets are small UI controls that the `Deck` class can mount in a view to manipulate the current view state.

Alongside classic navigation and overlay widgets, the package also exports deck-facing panel wrappers for assembling reusable sidebars, modals, and summary cards around a deck.gl canvas.

Panel definitions and standalone mounting live in [`@deck.gl-community/panels`](/docs/modules/panels/README). Import panels and panel containers from `panels`, then pass them to the panel widgets in this package.

:::caution
The deck.gl-community repository is semi-maintaned. One of its goals is to collect and preserve valuable deck.gl ecosystem related code that does not have a dedicated home. Some modules may no longer have dedicated maintainers. This means that there is sometimes no one who can respond quickly to issues.
:::

## Installation

```bash
npm install @deck.gl-community/widgets
```

## Usage

```tsx
import DeckGL from '@deck.gl/react';
import {OrthographicView} from '@deck.gl/core';
import {PanWidget, ZoomRangeWidget} from '@deck.gl-community/widgets';

const widgets = [
  new PanWidget({placement: 'top-left'}),
  new ZoomRangeWidget({placement: 'top-left', style: {marginTop: '80px'}})
];

export function App() {
  return (
    <DeckGL
      views={new OrthographicView({id: 'main'})}
      initialViewState={{target: [0, 0], zoom: 0}}
      controller={true}
      widgets={widgets}
      layers={[]}
    />
  );
}
```

The [Pan and Zoom widgets example](/examples/widgets/pan-and-zoom-controls) shows the controls managing an orthographic view over abstract data.

The [Widget Panels example](/examples/widgets/widget-panels) demonstrates the panel composition APIs with a persistent sidebar, a tabbed modal, and a static info box built from shared panel definitions.

For deck-independent mounting, use [`@deck.gl-community/panels`](/docs/modules/panels/README) and the [Standalone Widgets example](/examples/widgets/standalone-widgets).

See the [Panels developer guide](/docs/modules/panels/developer-guide/widget-panels) for the core panel composition concepts.

The [SharedTile2DLayer example](/examples/geo-layers/shared-tile-2d-layer) uses panel widgets to combine markdown and live probe.gl stats in one collapsible `BoxPanelWidget`.

### HTML overlays

Use `HtmlOverlayWidget` when you need HTML anchored to geographic coordinates. The widget renders
with **Preact**, so items can be created with `preact.h` and supplied as `items`:

```tsx
import {h} from 'preact';
import {HtmlOverlayItem, HtmlOverlayWidget} from '@deck.gl-community/widgets';

const overlayWidget = new HtmlOverlayWidget({
  items: data.map((item) =>
    h(HtmlOverlayItem, {coordinates: item.coordinates, key: item.id}, item.label)
  )
});
```

The [HTML overlays example](/examples/widgets/html-overlays) shows styled city callouts bound to
map positions via the widget lifecycle.

## Classic Widgets

- [HeapMemoryWidget](./api-reference/heap-memory-widget.md)
- [PanWidget](./api-reference/pan-widget.md)
- [ResetViewWidget](./api-reference/reset-view-widget.md)
- [YZoomWidget](./api-reference/y-zoom-widget.md)
- [ZoomRangeWidget](./api-reference/zoom-range-widget.md)
- [ToolbarWidget](./api-reference/toolbar-widget.md)

## Overlay Widgets

- [HtmlOverlayWidget](./api-reference/html-overlay-widget.md)
- [HtmlClusterWidget](./api-reference/html-cluster-widget.md)
- [HtmlOverlayItem](./api-reference/html-overlay-item.md)
- [HtmlTooltipWidget](./api-reference/html-tooltip-widget.md)

## Advanced UI Widgets

- [OmniBoxPanelWidget](./api-reference/omni-box-widget.md)
- [ToastWidget](./api-reference/toast-widget.md)
- [TimeMeasureWidget](./api-reference/time-measure-widget.md)

## Panel Widgets

Widgets that host reusable panel content:

- [BoxPanelWidget](./api-reference/box-widget.md)
- [FullScreenPanelWidget](./api-reference/full-screen-panel-widget.md)
- [ModalPanelWidget](./api-reference/modal-widget.md)
- [SidebarPanelWidget](./api-reference/sidebar-widget.md)

Use panel definitions from [`@deck.gl-community/panels`](/docs/modules/panels/README):

- [Using with deck.gl](/docs/modules/panels/developer-guide/using-with-deck-gl)
- [Leaf Panels](/docs/modules/panels/api-reference/custom-panel)
- [Composite Panels](/docs/modules/panels/api-reference/accordeon-panel)
- [Panel Containers](/docs/modules/panels/api-reference/panel-container)
