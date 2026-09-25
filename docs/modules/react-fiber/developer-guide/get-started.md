# Get started

`@deck.gl-community/react-fiber` renders deck.gl in a React client tree. The native package exports `DeckGL`; it also adds the `<layer>` and `<view>` JSX elements that pass already constructed deck.gl descriptors to the renderer.

## 1. Install the packages you use

Install React, the renderer, and the deck.gl packages used by the application:

```bash
npm install react react-dom @deck.gl-community/react-fiber @deck.gl/core @deck.gl/layers @deck.gl/mapbox
```

The renderer requires React 19 or later and is built for the deck.gl 9.4 package family. Its peer-dependency contract includes `@deck.gl/mapbox`, even for standalone roots, because the renderer imports `MapboxOverlay` internally. Let the package manager resolve the package's deck.gl, loaders.gl, and luma.gl peers, and add the matching deck.gl layer package when the application imports layers from it.

## 2. Render on the client

The native root creates a browser renderer. In an application that uses React Server Components, put `'use client'` at the beginning of the module that imports `DeckGL`, or import it from an existing client-marked module. This React directive marks that module and its transitive dependencies as client code; Next.js is one framework that supports it. In traditional SSR without React Server Components, initialize a map or overlay after hydration in an effect.

## 3. Size a standalone root

Without a `canvas` prop, `DeckGL` renders an unstyled wrapper and canvas. Give its container a size in application CSS, or the browser uses a 300 × 150 canvas by default. Supplying `canvas` tells the component to use a canvas you render and size yourself; it then renders no wrapper or canvas.

## 4. Create layers as React elements

Pass a deck.gl `Layer` instance to the universal `<layer>` element. Layer instances are descriptors, so the renderer can pass the complete list to deck.gl on each committed React update. deck.gl matches the descriptors by `id`, making a stable, unique ID essential for correct and efficient updates.

```tsx
import {DeckGL} from '@deck.gl-community/react-fiber';
import {ScatterplotLayer} from '@deck.gl/layers';

export function App({data}: {data: Array<{coordinates: [number, number]}>) {
  return (
    <DeckGL initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}} controller>
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

Use ordinary React components to organize a map. A component may create its own descriptor and return one `<layer>` element. Use `useMemo` when the layer creation depends on expensive work or when the application needs a stable object for another reason; the renderer itself still reconciles the resulting descriptors by ID.

## 5. Add views deliberately

Pass a deck.gl `View` instance to `<view>`, also with an explicit ID:

```tsx
import {MapView} from '@deck.gl/core';

<DeckGL initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}} controller>
  <view view={new MapView({id: 'main-map'})} />
  <layer layer={/* a deck.gl Layer instance */} />
</DeckGL>;
```

The React tree is flattened before deck.gl receives it. Therefore, a `<view>` can contain React children for application composition, but it does not scope its child layers to that view. The standalone renderer supplies the flattened view list to `Deck`; an interleaved `MapboxOverlay` gets its views from the map integration instead.

## 6. Combine JSX and `layers` only when needed

`DeckGL` accepts the normal deck.gl `layers` prop as well as `<layer>` children. The renderer prepends the `layers` prop to the layers produced by JSX. This is useful while incrementally moving an existing deck.gl configuration to React, but all layers across both sources must have unique IDs.

```tsx
<DeckGL
  layers={[new ScatterplotLayer({id: 'existing-points', data: []})]}
  initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}}
>
  <layer layer={new ScatterplotLayer({id: 'react-points', data: []})} />
</DeckGL>;
```

## 7. Access the root instance when necessary

Use `onDeckglChange` to receive the root-specific `Deck` or `MapboxOverlay` instance. Store it in React state if another component needs to react to the instance becoming available:

```tsx
import {useEffect, useState} from 'react';
import {DeckGL, type DeckglInstance} from '@deck.gl-community/react-fiber';

function Map() {
  const [deckgl, setDeckgl] = useState<DeckglInstance | null>(null);

  useEffect(() => {
    if (!deckgl) {
      return;
    }

    // Connect imperative behavior to this root instance.
  }, [deckgl]);

  return (
    <DeckGL onDeckglChange={setDeckgl}>
      <layer layer={/* a deck.gl Layer instance */} />
    </DeckGL>
  );
}
```

The notification receives `null` when its root is cleaned up. It is not a callback ref: replacing only the callback does not reconfigure or unmount the root, although the replacement receives later lifecycle notifications.

## Interleave with a map renderer

Pass `interleaved` when the instance should be a `MapboxOverlay` controlled by a Mapbox- or MapLibre-style map. After `onDeckglChange` provides that instance, add it to the host map as a control and remove the control before destroying the map. Omit `interleaved` for a standalone `Deck`; even `interleaved={false}` selects the overlay path because the renderer checks whether the prop is present. In this mode, the map integration owns views, so do not use JSX `<view>` elements to configure the overlay.

Deck callbacks such as `onClick` are deck.gl event handlers passed to the root, not React synthetic events on `<layer>` or `<view>`.

## Next steps

Read the [DeckGL API](../api-reference/deckgl.md) for standalone and interleaved ownership details, and [Native elements](../api-reference/native-elements.md) for the exact `<layer>` and `<view>` contract.

If you are migrating an existing `@deck.gl/react` application, use the bounded compatibility adapter rather than changing native imports in place. See [Migrate from `@deck.gl/react`](./migrate-from-deckgl-react.md) for its supported wrapper matrix and limitations.

For framework-specific project layouts, see the [React Fiber examples](/examples/react-fiber/overview).
