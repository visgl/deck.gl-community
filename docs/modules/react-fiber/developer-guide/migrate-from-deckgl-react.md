# Migrate from `@deck.gl/react`

`@deck.gl-community/react-fiber/compat` is an additive migration API for a
supported subset of `@deck.gl/react` applications. It lowers approved React
layer and view components to React Fiber's native `<layer>` and `<view>`
primitives. It is not full `@deck.gl/react` parity.

The adapter is client-bound because it uses the local DOM renderer. Keep it
inside the same client boundary as `Deckgl` in applications with SSR.

## Replace the root import

Change this:

```tsx
import {DeckGL} from '@deck.gl/react';
```

To this:

```tsx
import {DeckGL} from '@deck.gl-community/react-fiber/compat';
```

Layer wrappers are explicit subpath imports owned by this package. They are not
subpaths of `@deck.gl/react`.

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

`mVTLayer` and `mvtLayer` are deprecated aliases for `MVTLayer`. `wMSLayer` and
`wmsLayer` are deprecated aliases for `WMSLayer`.

The compatibility subpaths export only this matrix. They do not export
aggregation internals, aggregators, widgets, or `useWidget`.

## Render layers and views

Give each layer a stable ID and each view an explicit ID. The wrappers create
the matching deck.gl descriptor and lower it to the native reconciler:

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

The native `Deckgl`, `<layer>`, and `<view>` APIs remain available from the
root package. Use them when you need a renderer feature that compat does not
support.

## Ref and context

`DeckGLRef` has exactly these members:

- `deck`
- `pickObject`
- `pickObjects`
- `pickMultipleObjects`
- `pickObjectAsync`
- `pickObjectsAsync`

`deck` is `null` before initialization. Wait until it is available before
calling a picking method; calling one before initialization throws. Async
picking is unavailable for interleaved `MapboxOverlay` roots because that
deck.gl integration exposes only synchronous picking methods.

```tsx
import {createContext, createRef, useEffect} from 'react';
import {
  DeckGL,
  type DeckGLContextValue,
  type DeckGLRef
} from '@deck.gl-community/react-fiber/compat';

const DeckContext = createContext<DeckGLContextValue>({deck: null});
const deckRef = createRef<DeckGLRef>();

export function PickableMap() {
  useEffect(() => {
    if (deckRef.current?.deck) {
      deckRef.current.pickObject({x: 10, y: 10});
    }
  }, []);

  return <DeckGL ref={deckRef} ContextProvider={DeckContext.Provider} />;
}
```

A supplied `ContextProvider` receives only `{deck}`. Compat does not provide
official context fields such as `viewport`, `container`, `eventManager`,
`onViewStateChange`, or widgets.

## Review unsupported patterns

Before changing imports, review the application for these patterns:

- `gl`, `canvas`, `parent`, and `_customRender`: compat does not accept these
  low-level renderer ownership props. Continue using the native `Deckgl`
  component when they are required.
- Function children: compat does not support function-child render callbacks.
  Render supported layers and views directly instead.
- Widgets, JSX widget wrappers, and `useWidget`: these APIs are deferred and
  unavailable from compat.
- Extra layer or view components: only the export matrix above is supported.
- Interleaved rendering: `MapboxOverlay` owns its views. Compat view wrappers
  do not change the existing interleaved view limitation.

In development, detectable unsupported low-level props and function children
issue concise migration warnings. Production is silent; a missing warning does
not make an unsupported pattern work.
