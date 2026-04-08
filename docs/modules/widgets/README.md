# Overview

This package bundles widgets that integrate with deck.gl's built-in widget system. Widgets are small UI controls that the `Deck` class can mount in a view to manipulate the current view state.

Alongside classic navigation and overlay widgets, the package also exports generic panel widgets for assembling reusable sidebars, modals, and summary cards around a deck.gl canvas.

:::danger
The deck.gl-community repo is specifically set up to collect useful code that no longer has dedicated maintainers. This means that there is often no one who can respond quickly to issues. The vis.gl / Open Visualization team members who try to keep this running can only put a few hours into it every now and then. It is important to understand this limitation. If your project depends on timely fixes, and you are not able to contribute them yourself, deck.gl-community modules may not be the right choice for you.
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

See the [Widget Panels developer guide](./developer-guide/widget-panels.md) for the core panel composition concepts.

The [SharedTile2DLayer example](/examples/geo-layers/shared-tile-2d-layer) uses panel widgets to combine markdown and live probe.gl stats in one collapsible `BoxWidget`.

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

- [OmniBoxWidget](./api-reference/omni-box-widget.md)
- [ToastWidget](./api-reference/toast-widget.md)
- [TimeMeasureWidget](./api-reference/time-measure-widget.md)

## Panel Widgets

Widgets that host reusable panel content:

- [BoxWidget](./api-reference/box-widget.md)
- [FullScreenPanelWidget](./api-reference/full-screen-panel-widget.md)
- [ModalWidget](./api-reference/modal-widget.md)
- [SidebarWidget](./api-reference/sidebar-widget.md)

## Panels

Reusable panel definitions for panel widgets:

- [CustomPanel](./api-reference/custom-panel.md)
- [KeyboardShortcutsPanel](./api-reference/keyboard-shortcuts-panel.md)
- [MarkdownPanel](./api-reference/markdown-panel.md)
- [StatsPanel](./api-reference/stats-panel.md)
- [SettingsPanel](./api-reference/settings-panel.md)
- [TextEditorPanel](./api-reference/text-editor-panel.md)

## Container Panels

- [AccordeonPanel](./api-reference/accordeon-panel.md)
- [ColumnPanel](./api-reference/column-panel.md)
- [TabbedPanel](./api-reference/tabbed-panel.md)

## Related helpers

Several widgets wrap helper libraries rather than owning their own state model:

- `KeyboardShortcutsManager`
- `ToastManager`
