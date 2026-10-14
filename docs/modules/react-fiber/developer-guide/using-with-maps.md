# Using with maps

deck.gl works without a base map, but a base map gives geospatial layers context. This page
describes what is shared by every base-map integration of `@deck.gl-community/react-fiber`. Each
provider guide then covers installation, examples, and provider-specific options. For the
underlying deck.gl concepts, see deck.gl's [Using with map](https://deck.gl/docs/get-started/using-with-map)
guide.

## Overlaid and interleaved rendering

deck.gl integrates with a base map in one of two ways:

- **Overlaid:** deck.gl renders into its own canvas above the map, and the two cameras stay in
  sync. The two libraries render independently.
- **Interleaved:** deck.gl renders into the map's WebGL2 context, so deck.gl layers and map layers
  such as labels or 3D buildings can occlude each other.

deck.gl's guide describes both modes in detail:
[overlaid](https://deck.gl/docs/get-started/using-with-map#overlaid) and
[interleaved](https://deck.gl/docs/get-started/using-with-map#interleaved).

## Supported base maps

| Base map | Import path | deck.gl package | Host SDK | Overlaid | Interleaved | React Map GL | Guide | deck.gl guide |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mapbox GL JS | `@deck.gl-community/react-fiber/mapbox` | [`@deck.gl/mapbox`](https://deck.gl/docs/api-reference/mapbox/overview) | `mapbox-gl` | ✓ | ✓ | ✓ | [Using with Mapbox](./base-maps/using-with-mapbox.md) | [Using with Mapbox](https://deck.gl/docs/developer-guide/base-maps/using-with-mapbox) |
| MapLibre GL JS | `@deck.gl-community/react-fiber/maplibre` | [`@deck.gl/maplibre`](https://deck.gl/docs/api-reference/maplibre/overview) | `maplibre-gl` | ✓ | ✓ | ✓ | [Using with MapLibre](./base-maps/using-with-maplibre.md) | [Using with MapLibre](https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre) |
| Custom overlay | `createDeckGL` from `@deck.gl-community/react-fiber` | The overlay's package | The host's SDK | Overlay-specific | Overlay-specific | Overlay-specific | [Using with custom overlays](./base-maps/using-with-custom-overlays.md) | None |

## Choose a provider root

Use a provider root when the application owns a Mapbox or MapLibre map and needs deck.gl as a map
control:

```tsx
import {DeckGL as MapboxDeckGL} from '@deck.gl-community/react-fiber/mapbox';
import {DeckGL as MapLibreDeckGL} from '@deck.gl-community/react-fiber/maplibre';
```

A provider root creates the deck.gl control only. The application creates, configures, and removes
the host map. Keep map tokens, styles, camera options, terrain, projection, event handlers,
workers, and CSP configuration on the map creator or React Map GL `<Map>`, not on `DeckGL`.

## Choose the overlay mode

Both provider roots pass `interleaved?: boolean` to the overlay unchanged:

- Omit it, or pass `false`, for a dedicated deck canvas. This is the default of both
  [`MapboxOverlay`](https://deck.gl/docs/api-reference/mapbox/mapbox-overlay#constructor) and
  [`MapLibreOverlay`](https://deck.gl/docs/api-reference/maplibre/overview).
- Pass `true` to share the map's WebGL context.

Both overlays read `interleaved` only in their constructors. When the prop changes, `DeckGL`
finalizes the current overlay, which removes it from the map, and creates a new one.
`onDeckglChange` receives `null` and then the new instance. The attachment effects in the provider
guides handle the replacement because they depend on the overlay instance. The new overlay starts
without the old one's internal state, such as the hovered object. `interleaved` does not select the
provider; select Mapbox or MapLibre through the import path.

Provider roots render no host DOM node. You can place them inside a React Map GL `<Map>`, or beside
a manual `new Map({container})` integration without adding a child to the map container. JSX
`<view>` descriptors do not configure an external overlay because the host map owns views.

## Attach the overlay to the host map

The lifecycle has four steps:

1. Create the host map with its provider-specific options.
2. Receive the matching overlay through `onDeckglChange`.
3. After the map is ready, attach that exact overlay once. Mapbox and MapLibre use
   `map.addControl`.
4. During cleanup, detach the overlay only if it was attached, then destroy the map if the
   application created it. Mapbox and MapLibre use `map.removeControl`.

The cleanup must handle React Strict Mode and unmount-before-load. Track both disposal and whether
the overlay was attached, cancel the pending load callback, and never detach an overlay that was
not attached. Each provider guide shows this pattern with React Map GL and with a manually created
map.

## Provider prop boundary

The provider root accepts supported deck.gl and overlay props, including layers, effects,
picking callbacks, layer filtering, parameters, and `interleaved`. Do not pass map-owned values
to it. `canvas`, `parent`, `device`, `viewState`, `initialViewState`, and `controller` belong to
the host map. Some providers exclude more props; see the provider guide.

Use a standalone root when the application needs `Deck` and its canvas. For a compatible custom
overlay, use the native `createDeckGL` factory instead of trying to select a provider at render
time. See [Using with custom overlays](./base-maps/using-with-custom-overlays.md).

## Reverse-controlled maps

deck.gl's guides describe a third mode, reverse controlled, in which the `@deck.gl/react` `DeckGL`
component is the root, a React Map GL `<Map>` is its child, and deck.gl owns the camera. Provider
roots do not support this mode. `DeckGL` renders its children with the deck.gl reconciler, which
accepts only `<layer>` and `<view>` elements, so it cannot render a `<Map>` child.

## Base map renderer and data provider

The JavaScript library that renders the map is separate from the service that provides its data.
For example, MapLibre GL JS can render tiles from many vector tile services, and Mapbox GL JS can
render any source that serves Mapbox Vector Tiles. Follow the terms of use and attribution
requirements of both the rendering library and the data provider.
