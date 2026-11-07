# Native elements

![From v9.4](https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square)

The native renderer accepts three deck.gl JSX elements: `<layer>`, `<view>` and `<widget>`. They are available after importing the root package:

```tsx
import {DeckGL} from '@deck.gl-community/react-fiber';
```

The import also provides the TypeScript JSX declarations. The elements are not DOM elements and they do not create DOM nodes. Each one carries a constructed deck.gl descriptor into the React Fiber renderer. Normal React components can organize the tree when they ultimately return these elements, but raw DOM nodes and text do not belong inside `DeckGL`: the custom renderer rejects any other host children.

## `<layer>`

`<layer>` requires one prop named `layer`. Its value must be a deck.gl `Layer` instance.

```tsx
import {ScatterplotLayer} from '@deck.gl/layers';

<layer
  layer={
    new ScatterplotLayer({
      id: 'airports',
      data: airports,
      getPosition: airport => airport.coordinates,
      getRadius: 100
    })
  }
/>;
```

Use a stable, unique `id` for every layer. deck.gl uses IDs to compare new descriptors with prior descriptors. In development, the renderer warns about a missing layer ID and reports duplicate layer IDs in the committed JSX tree.

The `layer` prop is intentionally an instance rather than a set of JSX props. Use the layer class from its deck.gl package for its full, typed property API. For example, import `ScatterplotLayer` from `@deck.gl/layers`, not from the native React Fiber package.

## `<view>`

`<view>` requires one prop named `view`. Its value must be a deck.gl `View` instance.

```tsx
import {MapView} from '@deck.gl/core';

<view view={new MapView({id: 'main-map'})} />;
```

Give every view an explicit ID. The renderer warns in development when a view has no ID or uses deck.gl's default `unknown` ID.

## `<widget>`

`<widget>` requires one prop named `widget`. Its value must be a deck.gl `Widget` instance, such as one from `@deck.gl/widgets`.

```tsx
import {CompassWidget, ZoomWidget} from '@deck.gl/widgets';

<DeckGL initialViewState={INITIAL_VIEW_STATE} controller>
  <widget widget={new ZoomWidget({id: 'zoom'})} />
  {showCompass && <widget widget={new CompassWidget({id: 'compass'})} />}
</DeckGL>;
```

deck.gl matches widgets by ID, as it does layers. Rendering a new widget instance with the same ID updates the mounted widget's props instead of adding another one, so creating the instance during render is fine. A widget has no children. Like `<layer>`, nesting a `<widget>` inside a `<view>` does not attach it to that view; set the widget's `viewId` instead.

## Tree shape and deck.gl output

React components may return, nest, or conditionally render these elements. At commit time, the renderer walks the complete tree in depth-first order, then builds separate flat `layers`, `views` and `widgets` arrays for deck.gl. The order of the flattened layer list is the order deck.gl receives, so keep ordering deliberate.

This means that nesting is useful for React composition but does not create a parent-child deck.gl relationship. In this example, the layer is still placed in the root's flat layer list:

```tsx
<view view={new MapView({id: 'main-map'})}>
  <layer layer={new ScatterplotLayer({id: 'airports', data: airports})} />
</view>;
```

Use deck.gl's normal view and layer configuration when an application needs view-specific rendering behavior. For an interleaved `MapboxOverlay` root, the host map owns views; the renderer does not send JSX views to that overlay.

Refs on these intrinsic elements resolve to their deck.gl instance, not an internal renderer wrapper. Use this low-level escape hatch sparingly; normal React data flow and deck.gl props are easier to keep in sync.

## Mixing declarative and direct layers

The `DeckGL` root also accepts its usual `layers` prop. As in `@deck.gl/react`, the renderer places the layers produced by `<layer>` elements first and the direct layers after them, so direct layers draw on top. This supports incremental adoption, but it also means IDs must be unique across both lists.

```tsx
<DeckGL layers={[new ScatterplotLayer({id: 'existing-layer', data: []})]}>
  <layer layer={new ScatterplotLayer({id: 'react-layer', data: []})} />
</DeckGL>;
```

## Mixing JSX and direct views

The `views` prop works like it does in `@deck.gl/react`. Without `<view>` children, the root sends the `views` prop to deck.gl unchanged; without either, deck.gl uses its default view. When the root has both, it merges them by ID: a view from the prop replaces the `<view>` with the same ID, and other prop views follow the JSX views. Removing the last `<view>` falls back to the `views` prop, or to deck.gl's default view when there is no prop.

```tsx
<DeckGL views={[new MapView({id: 'main-map', controller: true})]}>
  <view view={new MapView({id: 'main-map'})} />
  <view view={new MapView({id: 'minimap', x: '75%', width: '25%', height: '25%'})} />
</DeckGL>;
```

Here deck.gl receives the prop's `main-map` view, then `minimap`. External-overlay roots do not merge views: they never send JSX views to the overlay, because the host map owns views, and they forward a `views` prop unchanged like any other overlay prop.

## Mixing JSX and direct widgets

The `widgets` prop is merged with `<widget>` children by ID, the same way as views: a widget from the prop replaces the `<widget>` with the same ID, and other prop widgets follow the JSX widgets. Removing the last `<widget>` leaves only the prop widgets. Unlike views, widgets are also sent to external-overlay roots, which pass them to the overlay's own `widgets` prop.
