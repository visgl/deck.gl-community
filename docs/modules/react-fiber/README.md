# @deck.gl-community/react-fiber

`@deck.gl-community/react-fiber` is a client-side React 19 renderer for deck.gl. It lets an application describe deck.gl layers and views in a React tree while keeping deck.gl's normal descriptor objects and ID-based diffing model.

The package has two deliberately different public surfaces:

| Use case | Import | What it provides |
| --- | --- | --- |
| New applications and renderer-level control | `@deck.gl-community/react-fiber` | The native `DeckGL` root plus the `<layer>` and `<view>` elements. |
| A gradual move from `@deck.gl/react` | `@deck.gl-community/react-fiber/compat` | A bounded `DeckGL` adapter and a supported set of JSX layer and view wrappers. |
| Direct reconciler integration | `@deck.gl-community/react-fiber/reconciler` | Advanced root-management APIs. Most applications should use the native root instead. |

## Client-only renderer

The native root creates a canvas-backed deck.gl renderer. In an application that uses React Server Components, put `'use client'` at the beginning of the module that imports and renders `DeckGL`, or import it from an existing client-marked module. This React directive marks that module and its transitive dependencies as client code; Next.js is one framework that supports it. In a traditional SSR application without React Server Components, create the map or overlay after hydration in an effect.

## How the native API works

`DeckGL` owns one `Deck` instance for standalone rendering, or one `MapboxOverlay` when `interleaved` is present. Its children use two intrinsic React elements:

- `<layer>` receives a constructed deck.gl `Layer` instance.
- `<view>` receives a constructed deck.gl `View` instance.

The renderer flattens the committed React tree into deck.gl's `layers` and `views` arrays. React components may be nested for application composition, but nesting a `<layer>` inside a `<view>` does not assign that layer to that view. Keep view-specific behavior in normal deck.gl configuration such as a layer filter, and give every layer and view a stable, explicit `id`.

```tsx
import {DeckGL} from '@deck.gl-community/react-fiber';
import {MapView} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';

export function Map({data}: {data: Array<{coordinates: [number, number]}>) {
  return (
    <DeckGL initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}} controller>
      <view view={new MapView({id: 'map'})} />
      <layer
        layer={
          new ScatterplotLayer({
            id: 'points',
            data,
            getPosition: point => point.coordinates,
            getRadius: 100
          })
        }
      />
    </DeckGL>
  );
}
```

## Installation

Install React 19 or later, the package, and the deck.gl packages that your application uses. This example installs the packages needed for the native scatterplot example:

```bash
npm install react react-dom @deck.gl-community/react-fiber @deck.gl/core @deck.gl/layers @deck.gl/mapbox
```

The package is built against the deck.gl 9.4 package family. It has non-optional deck.gl, loaders.gl, and luma.gl peer dependencies, including `@deck.gl/mapbox`, because the renderer imports `MapboxOverlay` for its root implementation. Let your package manager satisfy that peer-dependency contract and install the matching deck.gl layer package before importing a compatibility wrapper from that layer family.

## Standalone layout

Without `canvas`, a standalone root renders an unstyled wrapper and canvas. Give its container a size in application CSS; otherwise the browser's canvas default is only 300 × 150 pixels. Alternatively, provide and size the canvas in your own DOM tree with the `canvas` prop. In that case, `DeckGL` renders no wrapper or canvas itself.

## Guides and API reference

- [Get started](./developer-guide/get-started.md) explains the native root, client boundaries, layers, views, and instance access.
- [Migrate from `@deck.gl/react`](./developer-guide/migrate-from-deckgl-react.md) lists the supported compatibility wrappers and their limits.
- [DeckGL API](./api-reference/deckgl.md) documents root ownership and lifecycle behavior.
- [Native elements](./api-reference/native-elements.md) documents `<layer>` and `<view>`.
- [React Fiber examples](/examples/react-fiber/overview) link to the maintained Vite, Next.js, React Router, and TanStack Start applications.
