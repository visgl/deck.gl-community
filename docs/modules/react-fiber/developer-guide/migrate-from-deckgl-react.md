# Migrate from `@deck.gl/react`

`@deck.gl-community/react-fiber/compat` is an additive migration API for a supported subset of `@deck.gl/react` applications. It lowers approved React layer and view components to React Fiber's native `<layer>` and `<view>` primitives. It is not full `@deck.gl/react` parity.

The adapter uses the local DOM renderer. In an application that uses React Server Components, import it from the same React `'use client'` module as `DeckGL`, or from that module's client-marked dependency tree. In traditional SSR without React Server Components, initialize browser-only map work after hydration. New applications should normally use the native root and elements described in [Get started](./get-started.md) and [Native elements](../api-reference/native-elements.md). Use this adapter when its explicit wrapper matrix lets an existing application migrate without rewriting every supported layer at once.

## Replace the root import

Change this:

```tsx
import {DeckGL} from '@deck.gl/react';
```

To this:

```tsx
import {DeckGL} from '@deck.gl-community/react-fiber/compat';
```

Layer wrappers are explicit subpath imports owned by this package. They are not subpaths of `@deck.gl/react`.

```tsx
import {MapView} from '@deck.gl-community/react-fiber/compat';
import {ScatterplotLayer} from '@deck.gl-community/react-fiber/compat/layers';
```

## Supported exports

| Import | Exports |
| --- | --- |
| `@deck.gl-community/react-fiber/compat` | `DeckGL`, `MapView`, `OrthographicView`, `OrbitView`, `FirstPersonView`, `GlobeView`; types `DeckGLProps`, `DeckGLRef`, `DeckGLContextValue` |
| `/compat/layers` | `ArcLayer`, `BitmapLayer`, `IconLayer`, `LineLayer`, `PointCloudLayer`, `ScatterplotLayer`, `ColumnLayer`, `GridCellLayer`, `PathLayer`, `PolygonLayer`, `GeoJsonLayer`, `TextLayer`, `SolidPolygonLayer` |
| `/compat/geo-layers` | `S2Layer`, `QuadkeyLayer`, `TileLayer`, `H3ClusterLayer`, `H3HexagonLayer`, `Tile3DLayer`, `TerrainLayer`, `GeohashLayer`, `GreatCircleLayer`, `TripsLayer`, `MVTLayer`, `WMSLayer` |
| `/compat/aggregation-layers` | `ScreenGridLayer`, `HexagonLayer`, `ContourLayer`, `GridLayer`, `HeatmapLayer` |
| `/compat/mesh-layers` | `ScenegraphLayer`, `SimpleMeshLayer` |


The compatibility subpaths export only this matrix. They do not export aggregation internals, aggregators, widgets, or `useWidget`.

## Render layers and views

Give each layer a stable ID and each view an explicit ID. The wrappers create the matching deck.gl descriptor and lower it to the native reconciler:

```tsx
import {DeckGL, MapView} from '@deck.gl-community/react-fiber/compat';
import {ScatterplotLayer} from '@deck.gl-community/react-fiber/compat/layers';

export function Map({data}: {data: Array<{position: [number, number]}>}) {
  return (
    <DeckGL
      controller
      initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}}
    >
      <MapView id="main-map">
        <ScatterplotLayer
          id="points"
          data={data}
          getPosition={point => point.position}
          getRadius={100}
        />
      </MapView>
    </DeckGL>
  );
}
```

## Mix native and compat APIs during migration

Compat components turn into the same native `<layer>` and `<view>` elements used by React Fiber. You can use both styles in the same `DeckGL` tree. This lets you move to compat one layer at a time:

```tsx
import {ScatterplotLayer} from '@deck.gl/layers';
import {DeckGL} from '@deck.gl-community/react-fiber/compat';
import {PolygonLayer} from '@deck.gl-community/react-fiber/compat/layers';

export function MixedLayers() {
  return (
    <DeckGL initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}}>
      <layer layer={new ScatterplotLayer({id: 'native-points', data: []})} />
      <PolygonLayer id="compat-polygons" data={[]} />
    </DeckGL>
  );
}
```

Keep the native `<layer>` form when you already have a deck.gl layer instance, or when you need behavior that compat does not support. Change supported layers to compat components when you are ready.

Use the native root `DeckGL` when you need to control the renderer with props such as `gl`, `canvas`, `parent`, or `_customRender`.

Using both styles does not add compat support for other APIs. Unsupported wrappers, widgets, function children, and renderer-control props are still not available from compat.

The native `DeckGL`, `<layer>`, and `<view>` APIs remain available from the root package. Both the native renderer and the compatibility adapter are named `DeckGL`; choose the intended component by its import path. Use the native component when you need a renderer feature that compat does not support. The native root can also combine the ordinary `layers` prop with `<layer>` children; compat wrappers are only a JSX-to-native-element migration aid.

## Ref and context

The `/compat` adapter supports an imperative `ref` and optional `ContextProvider` as its instance-access paths. It does not accept the native `onDeckglChange` lifecycle notification.

`DeckGLRef` has exactly these members:

- `deck`
- `pickObject`
- `pickObjects`
- `pickMultipleObjects`
- `pickObjectAsync`
- `pickObjectsAsync`

`deck` is `null` before initialization. Wait until it is available before calling a picking method; calling one before initialization throws. Async picking is unavailable for interleaved `MapboxOverlay` roots because that deck.gl integration exposes only synchronous picking methods.

```tsx
import {createContext, useContext, useEffect, useRef} from 'react';
import {
  DeckGL,
  type DeckGLContextValue,
  type DeckGLRef
} from '@deck.gl-community/react-fiber/compat';

const DeckContext = createContext<DeckGLContextValue>({deck: null});

function PickOnReady() {
  const {deck} = useContext(DeckContext);

  useEffect(() => {
    if (deck) {
      deck.pickObject({x: 10, y: 10});
    }
  }, [deck]);

  return null;
}

export function PickableMap() {
  const deckRef = useRef<DeckGLRef>(null);

  return (
    <DeckGL ref={deckRef} ContextProvider={DeckContext.Provider}>
      <PickOnReady />
    </DeckGL>
  );
}
```

A supplied `ContextProvider` receives only `{deck}`. It is the reliable way to run an effect when the compat instance becomes available. Keep a ref local to the component when an interaction handler needs imperative picking access; changing a ref does not by itself rerun an effect. Compat does not provide official context fields such as `viewport`, `container`, `eventManager`, `onViewStateChange`, or widgets.

## Review unsupported patterns

Before changing imports, review the application for these patterns:

- `gl`, `canvas`, `parent`, and `_customRender`: compat does not accept these low-level renderer ownership props. Continue using the native `DeckGL` component when they are required.
- Function children: compat does not support function-child render callbacks. Render supported layers and views directly instead.
- Widgets, JSX widget wrappers, and `useWidget`: these APIs are deferred and unavailable from compat.
- Extra layer or view components: only the export matrix above is supported.
- Interleaved rendering: `MapboxOverlay` owns its views. Compat view wrappers do not change the existing interleaved view limitation.

In development, detectable unsupported low-level props and function children issue concise migration warnings. Production is silent; a missing warning does not make an unsupported pattern work.
