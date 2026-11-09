# Migrate from `@deck.gl/react`

React Fiber's `DeckGL` root takes the same deck.gl props as `@deck.gl/react`. Most of a migration
is changing imports and rewriting JSX layers and views as `<layer>` and `<view>` elements. This
page lists each change. Apps that render HTML or function children inside `DeckGL` need the most
work; see [Limitations](#limitations) first.

The root is client-only. In an app that uses React Server Components, import it from a
`'use client'` module, as described in [Get started](./get-started.md).

## Replace the root import

```tsx
// Before
import DeckGL from '@deck.gl/react';

// After
import {DeckGL} from '@deck.gl-community/react-fiber';
```

The root is a named export. It takes deck.gl props directly, including controlled `viewState`
and `initialViewState`.

For a `MapboxOverlay` or `MapLibreOverlay`, import the matching root instead and attach the
overlay to the map you create. See [Using with maps](./using-with-maps.md).

```tsx
import {DeckGL} from '@deck.gl-community/react-fiber/maplibre';
```

## Rewrite JSX layers and views

`@deck.gl/react` accepts layer classes as JSX children. React Fiber takes a layer instance on a
`<layer>` element and a view instance on a `<view>` element:

```tsx
// Before
<DeckGL initialViewState={INITIAL_VIEW_STATE} controller>
  <MapView id="main" />
  <ScatterplotLayer id="points" data={data} getPosition={d => d.position} />
</DeckGL>

// After
<DeckGL initialViewState={INITIAL_VIEW_STATE} controller>
  <view view={new MapView({id: 'main'})} />
  <layer layer={new ScatterplotLayer({id: 'points', data, getPosition: d => d.position})} />
</DeckGL>
```

`<layer>` elements can sit inside your own components at any depth.

Nesting a `<layer>` inside a `<view>` does not assign it to that view. The renderer flattens the
tree into one `layers` list, and deck.gl draws every layer in every view, as it does for the
`layers` prop. `@deck.gl/react` does not scope them either: it reads JSX layers only from the
direct children of `DeckGL`. Use deck.gl's `layerFilter` for per-view layers:

```tsx
<DeckGL layerFilter={({layer, viewport}) => viewport.id !== 'minimap' || layer.id === 'points'}>
```

### Keep the old JSX syntax

Native `<layer>` elements are the recommended form: they use the same constructor call as the
`layers` prop and every deck.gl example, and they accept any layer class without extra code. If you
would rather keep your existing JSX during a migration, wrapping layer classes as components is an
option, at the cost of one wrapper per layer class that your app maintains.

To keep `<ScatterplotLayer id="points" ... />` in your code, copy this helper into your app:

```tsx
import type {Layer} from '@deck.gl/core';

export function createLayerComponent<PropsT extends {id?: string}>(
  LayerClass: new (props: PropsT) => Layer
) {
  return function LayerComponent(props: PropsT) {
    return <layer layer={new LayerClass(props)} />;
  };
}
```

Wrap each layer class you use once, at module level:

```tsx
import {
  PolygonLayer as DeckPolygonLayer,
  ScatterplotLayer as DeckScatterplotLayer
} from '@deck.gl/layers';
import {DeckGL} from '@deck.gl-community/react-fiber';
import {createLayerComponent} from './create-layer-component';

const ScatterplotLayer = createLayerComponent(DeckScatterplotLayer);
const PolygonLayer = createLayerComponent(DeckPolygonLayer);

type Point = {position: [number, number]};

export function Map({points}: {points: Point[]}) {
  return (
    <DeckGL initialViewState={INITIAL_VIEW_STATE} controller>
      <PolygonLayer id="regions" data={[]} />
      <ScatterplotLayer<Point> id="points" data={points} getPosition={d => d.position} />
    </DeckGL>
  );
}
```

Aliasing the deck.gl imports keeps existing JSX unchanged. Wrapped components keep the layer's
type parameters, so `<ScatterplotLayer<Point> ... />` checks accessors against `Point`. Wrapped and
native layers can be mixed, so you can migrate one layer at a time.

For views, pass `children` through:

```tsx
import {MapView as DeckMapView, type View} from '@deck.gl/core';
import {createElement, type ReactNode} from 'react';

export function createViewComponent<PropsT extends {id?: string}>(
  ViewClass: new (props: PropsT) => View
) {
  return function ViewComponent({children, ...props}: PropsT & {children?: ReactNode}) {
    // `createElement` because @types/react's SVG `<view>` element type rejects the `view` prop.
    return createElement('view', {view: new ViewClass(props as PropsT)}, children);
  };
}

const MapView = createViewComponent(DeckMapView);

<MapView id="main">
  <ScatterplotLayer id="points" data={points} getPosition={d => d.position} />
</MapView>;
```

As with `<view>`, nesting keeps the tree readable but does not limit the layer to that view.

In `.tsx` files, TypeScript resolves `<view>` to the SVG element from `@types/react`, so the helper
creates the element with `createElement`. See
[#1037](https://github.com/visgl/deck.gl-community/issues/1037).

## Access the deck.gl instance

`onDeckChange` receives the `Deck` instance, or the overlay on a map root, and then `null` on
teardown. Store it in state and call picking methods on the instance itself:

```tsx
// Before
const deckRef = useRef<DeckGLRef>(null);
deckRef.current?.pickObject({x, y});

// After
const [deck, setDeck] = useState<Deck | null>(null);
deck?.pickObject({x, y});

<DeckGL onDeckChange={setDeck}>{/* ... */}</DeckGL>;
```

`@deck.gl/react`'s `DeckGLContext` has no equivalent. Pass the instance through your own context
or props instead.

## Limitations

- **HTML and function children.** `DeckGL` children may only be
  [native elements](../api-reference/native-elements.md) and components that render them. Render
  HTML overlays as siblings of `DeckGL` in a positioned container. For per-view content, read
  viewports from the instance with `deck.getViewports()`.
- **react-map-gl `<Map>` as a child.** Create the map yourself and use a map root. See
  [Reverse-controlled maps](./using-with-maps.md#reverse-controlled-maps).
- **JSX widgets and `useWidget`.** Render each widget as a
  [`<widget>`](../api-reference/native-elements.md#widget) element, or pass instances in the
  `widgets` prop.
- **A custom `Deck` class.** Not supported. For a custom overlay, use
  [`createDeckGL`](../api-reference/deckgl.md#custom-compatible-overlays).
- **React 18 and earlier.** React Fiber requires React 19.
