# Get Started

Install the renderer with React and the deck.gl packages used by your layers:

```bash
npm install @deck.gl-community/react-fiber @deck.gl/core @deck.gl/layers react react-dom
```

Create layers as React elements using the universal `layer` element. The layer
instance should have a stable ID so deck.gl can diff updates efficiently:

```tsx
import {Deckgl} from '@deck.gl-community/react-fiber';
import {ScatterplotLayer} from '@deck.gl/layers';

export function App({data}) {
  return (
    <Deckgl initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}} controller>
      <layer
        layer={
          new ScatterplotLayer({
            id: 'points',
            data,
            getPosition: (point) => point.coordinates,
            getRadius: 100
          })
        }
      />
    </Deckgl>
  );
}
```

Views use the same pattern:

```tsx
import {MapView} from '@deck.gl/core';

<view view={new MapView({id: 'main'})}>
  <layer layer={/* a deck.gl Layer instance */} />
</view>;
```

Use `useDeckgl()` inside a descendant component when direct access to the
underlying `Deck` or `MapboxOverlay` instance is needed.

## Migrating from `@deck.gl/react`

The root package continues to provide the native `Deckgl` API shown above.
For the supported React-style migration adapter, import `DeckGL` from
`@deck.gl-community/react-fiber/compat` and layer components from its explicit
family subpaths. See [Migrate from @deck.gl/react](./migrate-from-deckgl-react.md)
for the compatibility matrix and limitations.
