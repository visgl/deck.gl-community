# HtmlOverlayItem

An HTML element that will be positioned by [`HtmlOverlayWidget`](./html-overlay-widget.md) or
[`HtmlClusterWidget`](./html-cluster-widget.md).

`HtmlOverlayItem` **must** be produced as `items` for these widgets so that coordinates can be
projected into screen space.

```tsx
import {h} from 'preact';
import {HtmlOverlayItem} from '@deck.gl-community/widgets';

const item = h(
  HtmlOverlayItem,
  {
    style: {
      transform: 'translate(-50%,-50%)',
      pointerEvents: 'all'
    },
    coordinates,
    key
  },
  'YOUR CONTENT HERE'
);
```

## Props

### coordinates

Array of two (or three, if elevation is needed) numbers where the item will be displayed.

### style

Optional CSS properties for the inner container.

### key

Provide stable keys for arrays of items so that widget diffing behaves as expected.
