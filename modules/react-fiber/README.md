# @deck.gl-community/react-fiber

[![NPM Version](https://img.shields.io/npm/v/@deck.gl-community/react-fiber.svg)](https://www.npmjs.com/package/@deck.gl-community/react-fiber)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A client-side React 19 renderer for deck.gl. It lets you describe constructed deck.gl layers and
views in a React tree while deck.gl retains its normal descriptor objects and ID-based diffing.

## Installation

Use your preferred package manager to add the renderer, React, and the deck.gl packages used by
your application. These commands install the smallest set for the native scatterplot example below:

```bash
# Yarn
yarn add react react-dom @deck.gl-community/react-fiber @deck.gl/core @deck.gl/layers @deck.gl/mapbox

# pnpm
pnpm add react react-dom @deck.gl-community/react-fiber @deck.gl/core @deck.gl/layers @deck.gl/mapbox

# npm
npm install react react-dom @deck.gl-community/react-fiber @deck.gl/core @deck.gl/layers @deck.gl/mapbox
```

The package requires React 19 or later and uses the deck.gl 9.4 package family. It declares
non-optional peers for the following packages because the native and compatibility APIs can import
them:

| Package group | Peer packages |
| --- | --- |
| deck.gl | `@deck.gl/aggregation-layers`, `@deck.gl/core`, `@deck.gl/extensions`, `@deck.gl/geo-layers`, `@deck.gl/layers`, `@deck.gl/mapbox`, `@deck.gl/mesh-layers` |
| loaders.gl | `@loaders.gl/core` |
| luma.gl | `@luma.gl/core`, `@luma.gl/engine`, `@luma.gl/shadertools` |
| React | `react`, `react-dom` |

Keep these dependencies compatible with deck.gl 9.4. Add the matching deck.gl package before
importing a compatibility wrapper from that layer family. Your package manager may install or ask
you to provide the remaining peers explicitly.

TypeScript declarations are included. Importing the native root also adds the JSX declarations for
`<layer>` and `<view>`.

## Quick start

The native root runs in the browser. In an application that uses React Server Components, place
`'use client'` at the top of the module that imports `DeckGL`, or import it from an existing
client-marked module. In other server-rendered applications, create browser-only map work after
hydration.

Give the standalone root a sized container. Without a caller-provided `canvas`, it creates an
unstyled wrapper and canvas, and an unsized canvas defaults to 300 × 150 pixels.

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
previous version. The renderer can create a descriptor again on a React render; deck.gl still uses
the ID to update the existing layer correctly.

## How the native renderer works

`DeckGL` owns a standalone `Deck` by default. Its custom React reconciler collects `<layer>` and
`<view>` descriptors from the committed React tree, flattens the tree in depth-first order, and
passes separate `layers` and `views` arrays to deck.gl. This lets ordinary React components arrange
a map without changing deck.gl's descriptor model.

The tree shape is for React composition, not for assigning layers to views. A layer nested inside a
view still belongs to the root's flat layer list:

```tsx
import {MapView} from '@deck.gl/core';

<DeckGL initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}} controller>
  <view view={new MapView({id: 'main-map'})}>
    <layer layer={new ScatterplotLayer({id: 'points', data: points})} />
  </view>
</DeckGL>;
```

Give every view an explicit ID too. Use deck.gl's normal view and layer configuration when you
need view-specific behavior. The renderer reports missing or duplicate IDs in development because
they make deck.gl's diffing unreliable.

`DeckGL` also accepts deck.gl's ordinary `layers` prop. It prepends those layers to the layers
created by JSX, which helps with incremental migration. IDs must remain unique across both sources.

## Native API

Import the native root from the package root (or its `/dom` alias):

```tsx
import {DeckGL, type DeckglInstance, type DeckglProps, type OnDeckglChange} from '@deck.gl-community/react-fiber';
```

| Export | Description |
| --- | --- |
| `DeckGL` | The browser-only React Fiber root. It accepts deck.gl `DeckProps`, relevant `MapboxOverlay` options, descriptor children, and `onDeckglChange`. |
| `DeckglProps` | The native root's props type. It combines deck.gl `DeckProps` and `MapboxOverlayProps`, then adds optional children and `onDeckglChange`. |
| `DeckglInstance` | `Deck \| MapboxOverlay`, the instance owned by one native root. |
| `OnDeckglChange` | `(deckgl: DeckglInstance \| null) => void`, the lifecycle-notification type for `onDeckglChange`. |

The native JSX elements are available after importing `DeckGL`:

| Element | Required prop | Purpose |
| --- | --- | --- |
| `<layer>` | `layer={LayerInstance}` | Adds a constructed deck.gl `Layer` descriptor. |
| `<view>` | `view={ViewInstance}` | Adds a constructed deck.gl `View` descriptor. |

These are renderer descriptors, not DOM elements. They do not create DOM nodes, and raw DOM nodes
or text do not belong inside `DeckGL`. Refs on them resolve to the underlying deck.gl `Layer` or
`View` instance.

## Standalone and interleaved roots

| Mode | How to select it | Owner | Important behavior |
| --- | --- | --- | --- |
| Standalone | Omit `interleaved` | `DeckGL` owns a `Deck` and its canvas by default. | JSX views are passed to `Deck`. Supply `canvas` to use and size your own canvas; the component then renders no wrapper or canvas. |
| Interleaved map | Pass the `interleaved` prop | `DeckGL` owns a `MapboxOverlay`; the host Mapbox- or MapLibre-style map owns the map canvas and views. | Add the overlay after `onDeckglChange` supplies it, and remove it before destroying the host map. JSX `<view>` elements do not configure the overlay. |

`interleaved` is presence-based. Passing `interleaved={false}` still selects the
`MapboxOverlay` path because the renderer checks whether the prop exists. Omit the prop entirely
when you want a standalone `Deck`.

Deck callbacks such as `onClick` remain deck.gl callbacks. They are not React synthetic events on
`<layer>` or `<view>`.

## Access the root instance

Use `onDeckglChange` when an integration needs the root-specific `Deck` or `MapboxOverlay`. Store
the instance in state so React can coordinate the integration's setup and cleanup:

```tsx
import {useEffect, useState} from 'react';
import {DeckGL, type DeckglInstance} from '@deck.gl-community/react-fiber';

export function Map() {
  const [deckgl, setDeckgl] = useState<DeckglInstance | null>(null);

  useEffect(() => {
    if (!deckgl) return;

    // Add root-specific imperative integration here.
    return () => {
      // Remove that integration before the instance changes or disappears.
    };
  }, [deckgl]);

  return <DeckGL onDeckglChange={setDeckgl} />;
}
```

The notification receives `null` during root cleanup. It is not a callback ref: changing only the
callback identity does not reconfigure or unmount the root, and the replacement is used only for
later notifications.

## Compatibility API

Use the compatibility API only to migrate a supported `@deck.gl/react` component tree gradually:

```tsx
import {DeckGL, MapView} from '@deck.gl-community/react-fiber/compat';
import {ScatterplotLayer} from '@deck.gl-community/react-fiber/compat/layers';
```

`/compat` exports a bounded `DeckGL` adapter, view wrappers (`MapView`, `OrthographicView`,
`OrbitView`, `FirstPersonView`, and `GlobeView`), and its `DeckGLProps`, `DeckGLRef`, and
`DeckGLContextValue` types. Layer wrappers are split across these public entry points:

| Import path | Wrapper family |
| --- | --- |
| `@deck.gl-community/react-fiber/compat/layers` | Core deck.gl layer wrappers |
| `@deck.gl-community/react-fiber/compat/geo-layers` | Geospatial layer wrappers |
| `@deck.gl-community/react-fiber/compat/aggregation-layers` | Aggregation layer wrappers |
| `@deck.gl-community/react-fiber/compat/mesh-layers` | Mesh layer wrappers |

The compatibility adapter deliberately does not provide full `@deck.gl/react` parity. In
particular, use the native root when your application needs `canvas`, `gl`, `parent`, or
`_customRender`. Read the migration guide before replacing imports; it lists the supported wrapper
matrix, ref and context limits, interleaved-rendering limits, and unsupported function children and
widgets.

## Advanced reconciler API

`@deck.gl-community/react-fiber/reconciler` exports `createRoot`, `unmountAtNode`, `roots`, and the
`ReconcilerRoot` type. This entry point is for applications that must own the renderer root,
configuration, rendering, and cleanup themselves. Normal React applications should use `DeckGL`,
which owns that lifecycle.

The package manifest also exposes supporting implementation routes such as `/reconciler/config`,
`/reconciler/utils`, and `/shared`. They are not the recommended application API. Prefer the native,
compatibility, or reconciler entry points above so upgrades do not couple your application to host
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

- [Get started](../../docs/modules/react-fiber/developer-guide/get-started.md) covers client boundaries, layers, views, mixed layer sources, and instance access.
- [DeckGL API](../../docs/modules/react-fiber/api-reference/deckgl.md) covers ownership, lifecycle notifications, and standalone versus interleaved roots.
- [Native elements](../../docs/modules/react-fiber/api-reference/native-elements.md) defines the `<layer>` and `<view>` contract.
- [Migrate from `@deck.gl/react`](../../docs/modules/react-fiber/developer-guide/migrate-from-deckgl-react.md) documents the compatibility wrapper matrix and limits.
- Maintained applications show native integration with [Vite](../../examples/react-fiber/vite), [Next.js](../../examples/react-fiber/nextjs), [React Router](../../examples/react-fiber/react-router), and [TanStack Start](../../examples/react-fiber/tanstack-start).

## License and origin

This package is MIT licensed; see [LICENSE](./LICENSE). Its implementation began as a direct copy
of `deckgl-fiber-renderer/fiber.gl` 2.0.1 at commit
`9e348b677bc9a31cfb5facefc40dfb98bb790042` and retains that project's MIT license.
