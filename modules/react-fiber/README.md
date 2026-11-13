# @deck.gl-community/react-fiber

[![NPM Version](https://img.shields.io/npm/v/@deck.gl-community/react-fiber.svg)](https://www.npmjs.com/package/@deck.gl-community/react-fiber)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A client-side React 19 renderer for deck.gl. It lets a React tree describe deck.gl layers and
views while deck.gl keeps its descriptor objects and ID-based diffing.

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Choose a root](#choose-a-root)
- [Use layers, views, widgets and effects](#use-layers-views-widgets-and-effects)
- [Use a provider overlay](#use-a-provider-overlay)
- [Access the root instance](#access-the-root-instance)
- [Upgrade](#upgrade)
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

The package requires React 19 or later and uses the deck.gl 9.4 package family. `@deck.gl/core`,
`react` and `react-dom` are the only required peers. The other deck.gl packages are optional
peers: install `@deck.gl/mapbox` or `@deck.gl/maplibre` for its root, and a layer or widget
package for its component subpath, such as `@deck.gl/layers` for `/layers`. The root import loads
none of them. Keep installed deck.gl packages compatible with 9.4.

TypeScript declarations are included and need TypeScript 5.3 or later. A root import adds the JSX
declarations for `<deckLayer>`, `<deckView>`, `<deckWidget>` and `<deckEffect>`.

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
import {ScatterplotLayer} from '@deck.gl-community/react-fiber/layers';

type Point = {position: [number, number]};
const points: Point[] = [{position: [-122.4, 37.8]}];

export function Map() {
  return (
    <div style={{height: 500, position: 'relative'}}>
      <DeckGL initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}} controller>
        <ScatterplotLayer id="points" data={points} getPosition={d => d.position} getRadius={100} />
      </DeckGL>
    </div>
  );
}
```

Each layer needs a stable, unique `id`. The component builds a new layer on every render, and
deck.gl uses the ID to match it with the previous one and update only what changed.

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

## Use layers, views, widgets and effects

Import a component for each deck.gl class from the subpath named after its deck.gl module:

| Subpath | Components |
| --- | --- |
| `@deck.gl-community/react-fiber/core` | The views, such as `MapView`, plus `LightingEffect` and `PostProcessEffect` |
| `@deck.gl-community/react-fiber/layers` | Every layer in `@deck.gl/layers` |
| `@deck.gl-community/react-fiber/geo-layers` | Every layer in `@deck.gl/geo-layers` |
| `@deck.gl-community/react-fiber/aggregation-layers` | Every layer in `@deck.gl/aggregation-layers` |
| `@deck.gl-community/react-fiber/mesh-layers` | Every layer in `@deck.gl/mesh-layers` |
| `@deck.gl-community/react-fiber/widgets` | Every widget in `@deck.gl/widgets` |

Each component takes the class's props and builds a new instance on every render. Components can
sit anywhere inside your own components, which can use hooks and context:

```tsx
import {MapView} from '@deck.gl-community/react-fiber/core';
import {ScatterplotLayer} from '@deck.gl-community/react-fiber/layers';
import {ZoomWidget} from '@deck.gl-community/react-fiber/widgets';

function Airports() {
  const airports = useAirports();
  return <ScatterplotLayer id="airports" data={airports} getPosition={d => d.coordinates} />;
}

<DeckGL initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}} controller>
  <MapView id="main" />
  <Airports />
  <ZoomWidget id="zoom" />
</DeckGL>;
```

Props are type-checked against the class. Layer components infer the data type from `data`, or
take it as a type argument: `<ScatterplotLayer<Airport> ... />`.

For your own classes, `createLayerComponent`, `createViewComponent`, `createWidgetComponent` and
`createEffectComponent` make a component once, with no registration:

```tsx
import {createLayerComponent} from '@deck.gl-community/react-fiber';

export const FlowLayer = createLayerComponent(DeckFlowLayer);
```

The components render the native elements `<deckLayer>`, `<deckView>`, `<deckWidget>` and
`<deckEffect>`, which take an instance you build, for example in `useMemo`. See
[Components](../../docs/modules/react-fiber/api-reference/components.md) and
[Native elements](../../docs/modules/react-fiber/api-reference/native-elements.md).

The renderer flattens the tree into deck.gl's `layers`, `views`, `widgets` and `effects` lists. A
layer nested inside a view still draws in every view; use deck.gl's `layerFilter` for
view-specific layers. Give every view an explicit ID. Outside production builds, the renderer warns
about missing IDs and deck.gl warns about duplicate layer IDs.

`DeckGL` also accepts deck.gl's ordinary `layers` prop. As in `@deck.gl/react`, it appends those
layers after the layers created by JSX, so they draw on top. IDs must remain unique across both
sources.

## Use a provider overlay

A provider root selects only the deck.gl control. It does not create, configure, or remove the
host map. Pass map tokens, styles, camera settings, handlers, worker or CSP configuration, and
other map options to the Mapbox or MapLibre map creator.

Use `onDeckChange` to receive the overlay, store it in state, and attach it to the map once per
instance in an effect. Detach it during cleanup, then tear down the host map. Provider roots render
no host DOM node. `<deckView>` children render beside the map's own view, which the overlay keeps in
step with the map camera.

[Using with maps](../../docs/modules/react-fiber/developer-guide/using-with-maps.md) describes the
shared lifecycle. The [Mapbox](../../docs/modules/react-fiber/developer-guide/base-maps/using-with-mapbox.md)
and [MapLibre](../../docs/modules/react-fiber/developer-guide/base-maps/using-with-maplibre.md)
guides have complete examples and provider-specific options.

Deck callbacks such as `onClick` remain deck.gl callbacks, not React synthetic events.

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

## Upgrade

The [upgrade guide](../../docs/modules/react-fiber/developer-guide/migrate-from-deckgl-react.md)
lists the changes to make when coming from `@deck.gl/react`.

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

The package exports the root, `/mapbox`, `/maplibre`, `/reconciler` and the component subpaths
listed above. Internal modules such as the host configuration and root store are not importable.

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

- [Get started](../../docs/modules/react-fiber/developer-guide/get-started.md) covers client boundaries, layer and view components, mixed layer sources, provider installation, and instance access.
- [DeckGL API](../../docs/modules/react-fiber/api-reference/deckgl.md) defines standalone and provider-root props, ownership, lifecycle notifications, and custom compatible overlays.
- [Using with maps](../../docs/modules/react-fiber/developer-guide/using-with-maps.md) explains host-map ownership and the overlay lifecycle, and links one guide per provider with worker setup and shared-context rendering.
- [Components](../../docs/modules/react-fiber/api-reference/components.md) lists the component subpaths and the factories for custom classes.
- [Native elements](../../docs/modules/react-fiber/api-reference/native-elements.md) defines the `<deckLayer>`, `<deckView>`, `<deckWidget>` and `<deckEffect>` contract.
- [Upgrade guide](../../docs/modules/react-fiber/developer-guide/migrate-from-deckgl-react.md) lists the changes from `@deck.gl/react`.
- [Debugging](../../docs/modules/react-fiber/developer-guide/debugging.md) explains how to trace a problem through the renderer.
- Maintained applications show native MapLibre integration with [Vite](../../examples/react-fiber/vite), [Next.js](../../examples/react-fiber/nextjs), [React Router](../../examples/react-fiber/react-router), and [TanStack Start](../../examples/react-fiber/tanstack-start).

## License and origin

This package is MIT licensed; see [LICENSE](./LICENSE). Its implementation began as a direct copy
of `deckgl-fiber-renderer/fiber.gl` 2.0.1 at commit
`9e348b677bc9a31cfb5facefc40dfb98bb790042` and retains that project's MIT license.
