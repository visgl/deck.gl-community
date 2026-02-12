# Overview

This package bundles widgets that integrate with deck.gl's built-in widget system. Widgets are small UI controls that the `Deck` class can mount in a view to manipulate the current view state.

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

## Widgets

- [PanWidget](./api-reference/pan-widget.md)
- [ZoomRangeWidget](./api-reference/zoom-range-widget.md)
- [HtmlOverlayWidget](./api-reference/html-overlay-widget.md)
- [HtmlClusterWidget](./api-reference/html-cluster-widget.md)
- [HtmlOverlayItem](./api-reference/html-overlay-item.md)
- [HtmlTooltipWidget](./api-reference/html-tooltip-widget.md)
