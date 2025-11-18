# HtmlOverlayWidget

Use this widget to render HTML items anchored to geographic coordinates. It projects every
[`HtmlOverlayItem`](./html-overlay-item.md) into screen space using the current view and draws
them inside the widget container. If you need clustering, see
[HtmlClusterWidget](./html-cluster-widget.md).

The widget renders content with **Preact**. You can generate `items` with `preact.h` even when
instantiating the widget from a React app.

```tsx
import DeckGL from '@deck.gl/react';
import {h} from 'preact';
import {HtmlOverlayItem, HtmlOverlayWidget} from '@deck.gl-community/widgets';

const htmlOverlay = new HtmlOverlayWidget({
  viewId: 'main',
  items: data.map((item) =>
    h(HtmlOverlayItem, {key: item.id, coordinates: item.coordinates}, item.label)
  )
});

<DeckGL initialViewState={viewState} controller={true} widgets={[htmlOverlay]} layers={layers} />;
```

## Props

### viewId

Optional. The view id this widget should follow. Defaults to the containing view.

### overflowMargin

Optional. Default: `0`. Extra margin (in pixels) around the viewport before overlay items are hidden.

### zIndex

Optional. Default: `1`. z-index applied to the widget container.

### items

Optional. [`ComponentChildren`](https://preactjs.com/guide/v10/differences-to-react#component-children)
that include `coordinates` props. Items are projected to screen space and cloned with `x`/`y`
values before rendering.

## Methods

### scaleWithZoom(n)

Scales `n` relative to the current zoom level. Useful for adjusting item sizes while zooming.

### breakpointWithZoom(threshold, highValue, lowValue)

Returns `highValue` when the current zoom is above `threshold`, otherwise `lowValue`.
