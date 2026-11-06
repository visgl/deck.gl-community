# Migrate from `@deck.gl/react`

React Fiber's `DeckGL` root takes the same deck.gl props as `@deck.gl/react`. Most of a migration
is changing imports and rewriting JSX layers and views as `<layer>` and `<view>` elements. This
page lists each change. Apps that render HTML or function children inside `DeckGL` need the most
work; see [Review unsupported patterns](#review-unsupported-patterns) first.

The root is client-only. In an app that uses React Server Components, import it from a
`'use client'` module, as described in [Get started](./get-started.md).

## Replace the root import

```tsx
// Before
import DeckGL from '@deck.gl/react';

// After
import {DeckGL} from '@deck.gl-community/react-fiber';
```

The root is a named export. Its props, `layers`, `views`, `widgets`, controlled `viewState` and
`initialViewState` behave as they do in `@deck.gl/react`, and the standalone root renders the same
wrapper and canvas with the same default sizing and ids. See
[Root DOM and sizing](../api-reference/deckgl.md#root-dom-and-sizing).

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

Give every layer and view a stable `id`. deck.gl matches layers across renders by `id`, so creating
a new layer instance on each render is expected and cheap. `<layer>` elements can sit inside your
own components at any depth.

Nesting a `<layer>` inside a `<view>` does not assign it to that view. The renderer flattens the
tree into one `layers` list, and deck.gl draws every layer in every view, as it does for the
`layers` prop. `@deck.gl/react` does not scope them either: it reads JSX layers only from the
direct children of `DeckGL`. Use deck.gl's `layerFilter` for per-view layers:

```tsx
<DeckGL layerFilter={({layer, viewport}) => viewport.id !== 'minimap' || layer.id === 'points'}>
```

### Keep the old JSX syntax

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

Importing the deck.gl classes under an alias lets the components keep the class names, so
existing JSX does not change.

The wrapped component keeps the layer's type parameters. Pass the data type where you use it,
`<ScatterplotLayer<Point> ... />`, just as you would write `new ScatterplotLayer<Point>({...})`.
Accessors such as `getPosition` are then checked against `Point`. Without a type argument, `d` is
`any`, as it is with the deck.gl constructor.

Wrapped and native layers can be mixed in one tree, so an app can move one layer at a time.

Views take the same approach. Pass `children` through so that layers nested in a JSX view still
render:

```tsx
import {MapView as DeckMapView, type View} from '@deck.gl/core';
import type {ReactNode} from 'react';

export function createViewComponent<PropsT extends {id?: string}>(
  ViewClass: new (props: PropsT) => View
) {
  return function ViewComponent({children, ...props}: PropsT & {children?: ReactNode}) {
    return <view view={new ViewClass(props as PropsT)}>{children}</view>;
  };
}

const MapView = createViewComponent(DeckMapView);

<MapView id="main">
  <ScatterplotLayer id="points" data={points} getPosition={d => d.position} />
</MapView>;
```

As with `<view>`, nesting keeps the tree readable but does not limit the layer to that view.

## Access the deck.gl instance

`ref` receives the `Deck` instance, or the overlay on a map root. Call picking methods on the
instance itself:

```tsx
// Before
const deckRef = useRef<DeckGLRef>(null);
deckRef.current?.pickObject({x, y});

// After
const deckRef = useRef<Deck>(null);
deckRef.current?.pickObject({x, y});
```

A ref does not re-render. When a component must react to the instance becoming available, store it
in state with `onDeckChange`, which receives the instance and then `null` on teardown:

```tsx
const [deck, setDeck] = useState<Deck | null>(null);

<DeckGL onDeckChange={setDeck}>{/* ... */}</DeckGL>;
```

`@deck.gl/react`'s `DeckGLContext` has no equivalent. Pass the instance through your own context
or props instead.

## Review unsupported patterns

- **HTML and function children.** `DeckGL` children may only be `<layer>`, `<view>` and components
  that render them. Render HTML overlays as siblings of `DeckGL` in a positioned container. For
  per-view content, read viewports from the instance with `deck.getViewports()`.
- **react-map-gl `<Map>` as a child.** Create the map yourself and use a map root. See
  [Reverse-controlled maps](./using-with-maps.md#reverse-controlled-maps).
- **JSX widgets and `useWidget`.** Pass widget instances in the `widgets` prop:
  `widgets={[new ZoomWidget()]}`.
- **A custom `Deck` class.** Not supported. For a custom overlay, use
  [`createDeckGL`](../api-reference/deckgl.md#custom-compatible-overlays).
- **React 18 and earlier.** React Fiber requires React 19.
