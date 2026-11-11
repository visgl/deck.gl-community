# @deck.gl-community/react-fiber

[![NPM Version](https://img.shields.io/npm/v/@deck.gl-community/react-fiber.svg)](https://www.npmjs.com/package/@deck.gl-community/react-fiber)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A client-side React 19 renderer for deck.gl. It lets a React tree describe deck.gl layers and
views while deck.gl keeps its descriptor objects and ID-based diffing.

## Contents

- [Why layer instances](#why-layer-instances)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Choose a root](#choose-a-root)
- [Use layers and views](#use-layers-and-views)
- [Use a provider overlay](#use-a-provider-overlay)
- [Access the root instance](#access-the-root-instance)
- [Migration from deck.gl React](#migration-from-deckgl-react)
- [Custom compatible overlays](#custom-compatible-overlays)
- [Advanced reconciler API](#advanced-reconciler-api)
- [Documentation and examples](#documentation-and-examples)

## Why layer instances

`<layer>` takes the same layer instance as deck.gl's `layers` prop, and React Fiber passes it to
deck.gl unchanged. Compared with the JSX layers of `@deck.gl/react`:

| | `@deck.gl/react` JSX layers | React Fiber `<layer>` |
| --- | --- | --- |
| Where layers go | Direct children of `DeckGL` only | Any depth, inside your own components |
| Hooks and context | Only in the component that renders `DeckGL` | In every component that renders a `<layer>`. Contexts from outside `DeckGL` reach them. |
| TypeScript | Layer classes are not valid JSX components, so their props are not checked | Props are checked against the layer class, and `new ScatterplotLayer<Point>({...})` types the accessors |
| API | A JSX form to learn next to the deck.gl constructor | The deck.gl constructor, as used by the `layers` prop and every deck.gl example |

Custom, composite and community layers work the same way, with no wrapper or registration.

## Installation

Install React, the renderer, and the deck.gl packages that the application uses. The standalone
root does not need a map-provider package:

```bash
# Yarn
yarn add react react-dom @deck.gl-community/react-fiber @deck.gl/core @deck.gl/layers

# pnpm
pnpm add react react-dom @deck.gl-community/react-fiber @deck.gl/core @deck.gl/layers

# npm
npm install react react-dom @deck.gl-community/react-fiber @deck.gl/core @deck.gl/layers
```

Add a provider package only when you import its provider root. The application also installs and
owns its map SDK:

| Root | Add deck.gl package | Add host map SDK |
| --- | --- | --- |
| `@deck.gl-community/react-fiber/mapbox` | `@deck.gl/mapbox` | `mapbox-gl` |
| `@deck.gl-community/react-fiber/maplibre` | `@deck.gl/maplibre` | `maplibre-gl` |

For example:

```bash
yarn add @deck.gl/maplibre maplibre-gl
```

The package requires React 19 or later and uses the deck.gl 9.4 package family. `@deck.gl/core`,
`react` and `react-dom` are the only required peers. `@deck.gl/mapbox` and `@deck.gl/maplibre` are
optional peers; install the one you import. A standalone import does not load either provider.
Keep installed deck.gl packages compatible with 9.4. TypeScript declarations are included, and a
native root import adds the JSX declarations for `<layer>`, `<view>`, `<widget>` and `<effect>`.

## Quick start

The native root runs in the browser. In an application that uses React Server Components, put
`'use client'` at the top of the module that imports `DeckGL`, or import it from an existing
client-marked module. In other server-rendered applications, create browser-only map work after
hydration. Server rendering a `DeckGL` root does not require `ssr: false`: the standalone root
renders its wrapper and canvas markup, provider roots render no markup, and deck.gl or the overlay
is created only after hydration.

Give the standalone root a sized, positioned container. Without a caller-provided `canvas`, it
creates a wrapper and canvas like `@deck.gl/react`: the wrapper is absolutely positioned and fills
that container unless `width`, `height`, or `style` say otherwise.

```tsx
'use client';

import {DeckGL} from '@deck.gl-community/react-fiber';
import {ScatterplotLayer} from '@deck.gl/layers';

const points = [{position: [-122.4, 37.8] as [number, number]}];

export function Map() {
  return (
    <div style={{height: 500, position: 'relative'}}>
      <DeckGL initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}} controller>
        <layer
          layer={
            new ScatterplotLayer({
              id: 'points',
              data: points,
              getPosition: point => point.position,
              getRadius: 100
            })
          }
        />
      </DeckGL>
    </div>
  );
}
```

Each layer needs a stable, unique `id`. deck.gl uses that ID to compare a new descriptor with its
previous version. The renderer can create a descriptor again during a React render; deck.gl still
uses the ID to update the existing layer correctly.

## Choose a root

Choose the renderer from its import path. Do not select a provider through a prop.

| Import path | Instance | Use it when |
| --- | --- | --- |
| `@deck.gl-community/react-fiber` | `Deck` | The application needs a standalone deck.gl canvas. This is the default. |
| `@deck.gl-community/react-fiber/mapbox` | `MapboxOverlay` | The application owns a Mapbox map and attaches a deck.gl control. |
| `@deck.gl-community/react-fiber/maplibre` | `MapLibreOverlay` | The application owns a MapLibre map and attaches a deck.gl control. |

The root entry point creates only `Deck`. Its props are `DeckProps`, which has no `interleaved`
option, and `onDeckChange` receives `Deck | null`. Provider roots always create
their matching overlay and pass `interleaved` to it unchanged. The overlay applies its own default
(`false` for
[`MapboxOverlay`](https://deck.gl/docs/api-reference/mapbox/mapbox-overlay#constructor) and
[`MapLibreOverlay`](https://deck.gl/docs/api-reference/maplibre/overview)). `false` renders
to a separate deck canvas, and `true` shares the map's WebGL context. The prop does not select the
provider.

Both overlays read `interleaved` only in their constructors. When the prop changes, the provider
root finalizes the current overlay, which removes it from the map, and creates a new one.
`onDeckChange` receives `null` and then the new instance, which the application attaches.

## Use layers and views

`DeckGL` collects `<layer>` and `<view>` descriptors from the committed React tree, flattens the
tree in depth-first order, and passes separate `layers` and `views` arrays to standalone `Deck`.
The tree shape is for React composition, not for assigning layers to views. A layer nested inside
a view still belongs to the root's flat layer list:

```tsx
import {MapView} from '@deck.gl/core';

<DeckGL initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}} controller>
  <view view={new MapView({id: 'main-map'})}>
    <layer layer={new ScatterplotLayer({id: 'points', data: points})} />
  </view>
</DeckGL>;
```

Give every view an explicit ID. Use deck.gl's normal view and layer configuration when you need
view-specific behavior. Outside production builds, the renderer warns about missing IDs and deck.gl
warns about duplicate layer IDs, because both make deck.gl's diffing unreliable.

`DeckGL` also accepts deck.gl's ordinary `layers` prop. As in `@deck.gl/react`, it appends those
layers after the layers created by JSX, so they draw on top. This helps with incremental
migration. IDs must remain unique across both sources.

## Use a provider overlay

A provider root selects only the deck.gl control. It does not create, configure, or remove the
host map. Pass map tokens, styles, camera settings, handlers, worker or CSP configuration, and
other map options to the Mapbox or MapLibre map creator.

Use `onDeckChange` to receive the overlay, store it in state, and attach it to the map once per
instance in an effect. Detach it during cleanup, then tear down the host map. Provider roots render
no host DOM node. `<view>` children render beside the map's own view, which the overlay keeps in
step with the map camera.

[Using with maps](../../docs/modules/react-fiber/developer-guide/using-with-maps.md) describes the
shared lifecycle. The [Mapbox](../../docs/modules/react-fiber/developer-guide/base-maps/using-with-mapbox.md)
and [MapLibre](../../docs/modules/react-fiber/developer-guide/base-maps/using-with-maplibre.md)
guides have complete examples and provider-specific options.

Deck callbacks such as `onClick` remain deck.gl callbacks. They are not React synthetic events on
`<layer>` or `<view>`.

## Access the root instance

Use `onDeckChange` when an integration needs the root-specific `Deck`, `MapboxOverlay`, or
`MapLibreOverlay`. Store the instance in state so React can coordinate setup and cleanup:

```tsx
import {useEffect, useState} from 'react';
import type {Deck} from '@deck.gl/core';
import {DeckGL} from '@deck.gl-community/react-fiber';

export function Map() {
  const [deck, setDeck] = useState<Deck | null>(null);

  useEffect(() => {
    if (!deck) return;

    // Add standalone-root-specific imperative integration here.
    return () => {
      // Remove that integration before the instance changes or disappears.
    };
  }, [deck]);

  return <DeckGL onDeckChange={setDeck} />;
}
```

Provider callbacks infer their concrete overlay type from the import path. The notification
receives `null` during root cleanup. It is not a callback ref: changing only the callback identity
does not reconfigure or unmount the root, and the replacement is used only for later
notifications.

## Migration from deck.gl React

Rewrite JSX layers as `<layer>` elements, or copy the
10-line `createLayerComponent` helper from the
[migration guide](../../docs/modules/react-fiber/developer-guide/migrate-from-deckgl-react.md#keep-the-old-jsx-syntax)
to keep `<ScatterplotLayer id="points" ... />` syntax in your app.

## Custom compatible overlays

For an overlay not covered by the provider roots, such as the community Leaflet or Bing Maps
overlays, bind it with `createDeckGL`:

```tsx
import {createDeckGL} from '@deck.gl-community/react-fiber';

const DeckGL = createDeckGL({
  createExternalOverlay: props => new MyCompatibleOverlay(props)
});
```

[Using with custom overlays](../../docs/modules/react-fiber/developer-guide/base-maps/using-with-custom-overlays.md)
covers the overlay requirements, `recreateOverlayOnChange` and host attachment.

## Advanced reconciler API

`@deck.gl-community/react-fiber/reconciler` exports `createRoot`, `unmountAtNode`, `roots`, and the
`ReconcilerRoot` type. This entry point is for applications that must own renderer creation,
configuration, rendering, and cleanup. Normal React applications should use `DeckGL`, which owns
that lifecycle.

The package exports only the root, `/mapbox`, `/maplibre` and `/reconciler` entry points. Internal
modules such as the host configuration and root store are not importable.

Warnings and traces go through deck.gl's `log`. Root creation, unmounting and commits log at
level 3, and the props of every configure at level 4: run `deck.log.enable()` and
`deck.log.level = 3` in the browser console. The `debug` prop is a deck.gl prop and is passed to `Deck` or the overlay unchanged.

## Commands

From the repository root, install workspace dependencies and run the package test suite:

```bash
yarn
yarn workspace @deck.gl-community/react-fiber test
```

The package test command runs the public type tests and Vitest suite. Run the repository linter
before contributing JavaScript or TypeScript changes:

```bash
yarn lint
```

## Documentation and examples

- [Get started](../../docs/modules/react-fiber/developer-guide/get-started.md) covers client boundaries, layers, views, mixed layer sources, provider installation, and instance access.
- [DeckGL API](../../docs/modules/react-fiber/api-reference/deckgl.md) defines standalone and provider-root props, ownership, lifecycle notifications, and custom compatible overlays.
- [Using with maps](../../docs/modules/react-fiber/developer-guide/using-with-maps.md) explains host-map ownership and the overlay lifecycle, and links one guide per provider with worker setup and shared-context rendering.
- [Native elements](../../docs/modules/react-fiber/api-reference/native-elements.md) defines the `<layer>`, `<view>`, `<widget>` and `<effect>` contract.
- [Migrate from `@deck.gl/react`](../../docs/modules/react-fiber/developer-guide/migrate-from-deckgl-react.md) lists each change and the `createLayerComponent` recipe.
- [Debugging](../../docs/modules/react-fiber/developer-guide/debugging.md) explains how to trace a problem through the renderer.
- Maintained applications show native MapLibre integration with [Vite](../../examples/react-fiber/vite), [Next.js](../../examples/react-fiber/nextjs), [React Router](../../examples/react-fiber/react-router), and [TanStack Start](../../examples/react-fiber/tanstack-start).

## License and origin

This package is MIT licensed; see [LICENSE](./LICENSE). Its implementation began as a direct copy
of `deckgl-fiber-renderer/fiber.gl` 2.0.1 at commit
`9e348b677bc9a31cfb5facefc40dfb98bb790042` and retains that project's MIT license.
