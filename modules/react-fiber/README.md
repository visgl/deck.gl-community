# @deck.gl-community/react-fiber

[![NPM Version](https://img.shields.io/npm/v/@deck.gl-community/react-fiber.svg)](https://www.npmjs.com/package/@deck.gl-community/react-fiber)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A client-side React 19 renderer for deck.gl. It lets a React tree describe deck.gl layers and
views while deck.gl keeps its descriptor objects and ID-based diffing.

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Choose a root](#choose-a-root)
- [Use layers and views](#use-layers-and-views)
- [Use a provider overlay](#use-a-provider-overlay)
- [Access the root instance](#access-the-root-instance)
- [Compatibility API](#compatibility-api)
- [Custom compatible overlays](#custom-compatible-overlays)
- [Advanced reconciler API](#advanced-reconciler-api)
- [Documentation and examples](#documentation-and-examples)

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

The package requires React 19 or later and uses the deck.gl 9.4 package family. `@deck.gl/mapbox`
and `@deck.gl/maplibre` are optional peers. A standalone import does not load either provider.
Keep installed deck.gl packages compatible with 9.4. TypeScript declarations are included, and a
native root import adds the JSX declarations for `<layer>` and `<view>`.

## Quick start

The native root runs in the browser. In an application that uses React Server Components, put
`'use client'` at the top of the module that imports `DeckGL`, or import it from an existing
client-marked module. In other server-rendered applications, create browser-only map work after
hydration. Server rendering a `DeckGL` root does not require `ssr: false`: the standalone root
renders its wrapper and canvas markup, provider roots render no markup, and deck.gl or the overlay
is created only after hydration.

Give the standalone root a sized container. Without a caller-provided `canvas`, it creates an
unstyled wrapper and canvas. An unsized canvas defaults to 300 × 150 pixels.

```tsx
'use client';

import {DeckGL} from '@deck.gl-community/react-fiber';
import {ScatterplotLayer} from '@deck.gl/layers';

const points = [{position: [-122.4, 37.8] as [number, number]}];

export function Map() {
  return (
    <div style={{height: 500}}>
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
| `@deck.gl-community/react-fiber` or `/dom` | `Deck` | The application needs a standalone deck.gl canvas. This is the default. |
| `@deck.gl-community/react-fiber/mapbox` | `MapboxOverlay` | The application owns a Mapbox map and attaches a deck.gl control. |
| `@deck.gl-community/react-fiber/maplibre` | `MapLibreOverlay` | The application owns a MapLibre map and attaches a deck.gl control. |

The root and `/dom` entry points create only `Deck`. Their props are `DeckProps`, which has no
`interleaved` option, and `onDeckglChange` receives `Deck | null`. Provider roots always create
their matching overlay and pass `interleaved` to it unchanged. The overlay applies its own default
(`false` for
[`MapboxOverlay`](https://deck.gl/docs/api-reference/mapbox/mapbox-overlay#constructor) and
[`MapLibreOverlay`](https://deck.gl/docs/api-reference/maplibre/overview)). `false` renders
to a separate deck canvas, and `true` shares the map's WebGL context. The prop does not select the
provider.

Both overlays read `interleaved` only in their constructors. When the prop changes, the provider
root finalizes the current overlay, which removes it from the map, and creates a new one.
`onDeckglChange` receives `null` and then the new instance, which the application attaches.

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
view-specific behavior. The renderer reports missing or duplicate IDs in development because they
make deck.gl's diffing unreliable.

`DeckGL` also accepts deck.gl's ordinary `layers` prop. It prepends those layers to the layers
created by JSX, which helps with incremental migration. IDs must remain unique across both
sources.

## Use a provider overlay

A provider root selects only the deck.gl control. It does not create, configure, or remove the
host map. Pass map tokens, styles, camera settings, handlers, worker or CSP configuration, and
other map options to the Mapbox or MapLibre map creator.

Use `onDeckglChange` to receive the overlay after the provider root is configured. Add that same
overlay with `map.addControl`, remove it with `map.removeControl` during cleanup, and then tear
down the host map. Provider roots render no host DOM node, so they can be children of a React Map
GL `<Map>` or coexist with a manual MapLibre container that must remain child-free.

The host map owns views. JSX `<view>` descriptors do not configure external overlays. For shared
contexts, configure ordering and WebGL options on the host map: use `beforeId` or a Mapbox Standard
`slot` for Mapbox, and `beforeId` for MapLibre. MapLibre interleaved rendering requires WebGL2 and
allows one interleaved overlay per map.

Deck callbacks such as `onClick` remain deck.gl callbacks. They are not React synthetic events on
`<layer>` or `<view>`.

## Access the root instance

Use `onDeckglChange` when an integration needs the root-specific `Deck`, `MapboxOverlay`, or
`MapLibreOverlay`. Store the instance in state so React can coordinate setup and cleanup:

```tsx
import {useEffect, useState} from 'react';
import {DeckGL, type DeckglInstance} from '@deck.gl-community/react-fiber';

export function Map() {
  const [deckgl, setDeckgl] = useState<DeckglInstance | null>(null);

  useEffect(() => {
    if (!deckgl) return;

    // Add standalone-root-specific imperative integration here.
    return () => {
      // Remove that integration before the instance changes or disappears.
    };
  }, [deckgl]);

  return <DeckGL onDeckglChange={setDeckgl} />;
}
```

Provider callbacks infer their concrete overlay type from the import path. The notification
receives `null` during root cleanup. It is not a callback ref: changing only the callback identity
does not reconfigure or unmount the root, and the replacement is used only for later
notifications.

## Compatibility API

Use the compatibility API only to migrate a supported `@deck.gl/react` component tree gradually.
Choose its root with the same import-path rule:

| Import path | Instance |
| --- | --- |
| `@deck.gl-community/react-fiber/compat` | `Deck` |
| `@deck.gl-community/react-fiber/compat/mapbox` | `MapboxOverlay` |
| `@deck.gl-community/react-fiber/compat/maplibre` | `MapLibreOverlay` |

The plain `/compat` root accepts `DeckProps`, which has no `interleaved` option.
Provider-specific compatibility roots keep the same host-map ownership, `interleaved` behavior, and
view limitations as their native counterparts. When a provider root recreates its overlay,
`ref.deck` points at the new instance.

Layer wrappers are split across these public entry points:

| Import path | Wrapper family |
| --- | --- |
| `@deck.gl-community/react-fiber/compat/layers` | Core deck.gl layer wrappers |
| `@deck.gl-community/react-fiber/compat/geo-layers` | Geospatial layer wrappers |
| `@deck.gl-community/react-fiber/compat/aggregation-layers` | Aggregation layer wrappers |
| `@deck.gl-community/react-fiber/compat/mesh-layers` | Mesh layer wrappers |

The compatibility adapter deliberately does not provide full `@deck.gl/react` parity. In
particular, use the native root when an application needs `canvas`, `gl`, `parent`, or
`_customRender`. Read the migration guide before replacing imports; it lists the supported wrapper
matrix, ref and context limits, overlay choices, and unsupported function children and widgets.

## Custom compatible overlays

For a compatible overlay not covered by the provider roots, create a component with a factory:

```tsx
import {createDeckGL} from '@deck.gl-community/react-fiber';

const DeckGL = createDeckGL({
  createExternalOverlay: props => new MyCompatibleOverlay(props)
});
```

The factory runs once when its root is first configured. It is not a render prop and does not reach
`setProps`. The result must implement deck.gl's `setProps` and `finalize` lifecycle.

If the overlay reads some props only at construction, list them in `recreateOnChange`. When one of
them changes (compared with `Object.is`), the component finalizes the overlay and calls the factory
again with the full props. `onDeckglChange` receives `null` and then the new instance:

```tsx
const DeckGL = createDeckGL({
  createExternalOverlay: props => new MyCompatibleOverlay(props),
  recreateOnChange: ['interleaved']
});
```

Recreating an overlay discards its internal state, such as the hovered object. This advanced native API is for compatible custom overlays;
normal applications should use the standalone, Mapbox, or MapLibre import path.

## Advanced reconciler API

`@deck.gl-community/react-fiber/reconciler` exports `createRoot`, `unmountAtNode`, `roots`, and the
`ReconcilerRoot` type. This entry point is for applications that must own renderer creation,
configuration, rendering, and cleanup. Normal React applications should use `DeckGL`, which owns
that lifecycle.

The package manifest also exposes supporting implementation routes such as `/reconciler/config`,
`/reconciler/utils`, and `/shared`. They are not the recommended application API. Prefer the
native, compatibility, or reconciler entry points so upgrades do not couple an application to host
configuration details.

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
- [Mapbox and MapLibre integration](../../docs/modules/react-fiber/developer-guide/mapbox-maplibre.md) explains host-map ownership, control lifecycle, worker setup, and shared-context rendering.
- [Native elements](../../docs/modules/react-fiber/api-reference/native-elements.md) defines the `<layer>` and `<view>` contract.
- [Migrate from `@deck.gl/react`](../../docs/modules/react-fiber/developer-guide/migrate-from-deckgl-react.md) documents the compatibility wrapper matrix and limits.
- Maintained applications show native MapLibre integration with [Vite](../../examples/react-fiber/vite), [Next.js](../../examples/react-fiber/nextjs), [React Router](../../examples/react-fiber/react-router), and [TanStack Start](../../examples/react-fiber/tanstack-start).

## License and origin

This package is MIT licensed; see [LICENSE](./LICENSE). Its implementation began as a direct copy
of `deckgl-fiber-renderer/fiber.gl` 2.0.1 at commit
`9e348b677bc9a31cfb5facefc40dfb98bb790042` and retains that project's MIT license.
