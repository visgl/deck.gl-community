# Native elements

The native renderer accepts exactly two deck.gl JSX elements: `<layer>` and `<view>`. They are available after importing the root package:

```tsx
import {DeckGL} from '@deck.gl-community/react-fiber';
```

The import also provides the TypeScript JSX declarations. The elements are not DOM elements and they do not create DOM nodes. Each one carries a constructed deck.gl descriptor into the React Fiber renderer. Normal React components can organize the tree when they ultimately return these elements, but raw DOM nodes and text do not belong inside `DeckGL`: the custom renderer rejects host children other than `<layer>` and `<view>`.

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

## Tree shape and deck.gl output

React components may return, nest, or conditionally render these elements. At commit time, the renderer walks the complete tree in depth-first order, then builds separate flat `layers` and `views` arrays for deck.gl. The order of the flattened layer list is the order deck.gl receives, so keep ordering deliberate.

This means that nesting is useful for React composition but does not create a parent-child deck.gl relationship. In this example, the layer is still placed in the root's flat layer list:

```tsx
<view view={new MapView({id: 'main-map'})}>
  <layer layer={new ScatterplotLayer({id: 'airports', data: airports})} />
</view>;
```

Use deck.gl's normal view and layer configuration when an application needs view-specific rendering behavior. For an interleaved `MapboxOverlay` root, the host map owns views; the renderer does not send JSX views to that overlay.

Refs on these intrinsic elements resolve to their deck.gl `Layer` or `View` instance, not an internal renderer wrapper. Use this low-level escape hatch sparingly; normal React data flow and deck.gl props are easier to keep in sync.

## Mixing declarative and direct layers

The `DeckGL` root also accepts its usual `layers` prop. The renderer prepends those direct layers to the layers produced by `<layer>` elements. This supports incremental adoption, but it also means IDs must be unique across both lists.

```tsx
<DeckGL layers={[new ScatterplotLayer({id: 'existing-layer', data: []})]}>
  <layer layer={new ScatterplotLayer({id: 'react-layer', data: []})} />
</DeckGL>;
```

## Errors and limits

A `<layer>` without a `layer` prop and a `<view>` without a `view` prop fail at runtime. The renderer rejects every other native element type. Pass a `View` to `<view>`, not to `<layer>`; development builds report that mistake to help catch it early.
