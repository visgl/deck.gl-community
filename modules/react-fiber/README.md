# @deck.gl-community/react-fiber

[![NPM Version](https://img.shields.io/npm/v/@deck.gl-community/react-fiber.svg)](https://www.npmjs.com/package/@deck.gl-community/react-fiber)
[![NPM Downloads](https://img.shields.io/npm/dw/@deck.gl-community/react-fiber.svg)](https://www.npmjs.com/package/@deck.gl-community/react-fiber)

A direct community fork of Brandon Pierce's React Fiber renderer for deck.gl.
It makes deck.gl layers and views first-class React elements, with support for
nested composition, hooks, persistence-mode reconciliation, and TypeScript JSX
types.

```tsx
import {Deckgl} from '@deck.gl-community/react-fiber';
import {ScatterplotLayer} from '@deck.gl/layers';

export function Map() {
  return (
    <Deckgl initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}}>
      <layer
        layer={
          new ScatterplotLayer({
            id: 'points',
            data: [],
            getPosition: (point) => point.coordinates
          })
        }
      />
    </Deckgl>
  );
}
```

The implementation is copied from `deckgl-fiber-renderer/fiber.gl` version
2.0.1 at commit `9e348b677bc9a31cfb5facefc40dfb98bb790042` and remains MIT
licensed. The source layout is preserved under `src/dom`, `src/reconciler`,
`src/shared`, and `src/types`.

The root entry point exposes `Deckgl`, `useDeckgl`, and `extend`. Advanced
entrypoints are available directly through the `/reconciler`, `/shared`, and
`/types` subpaths.

## Installation

```bash
npm install @deck.gl-community/react-fiber @deck.gl/core @deck.gl/layers react react-dom
```

React 19 and deck.gl 9.4 are supported by this initial community release.
