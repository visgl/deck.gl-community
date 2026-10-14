# Using with custom overlays

The Mapbox and MapLibre provider roots are thin bindings of the native `createDeckGL` factory. Use
the same factory to bring your own overlay: a deck.gl overlay for a host map that has no provider
root in this package. Examples of such hosts include the Leaflet and Bing Maps integrations in
this repository:

- [`@deck.gl-community/leaflet`](../../../leaflet/README.md) and its
  [`DeckOverlay`](../../../leaflet/api-reference/deck-overlay.md)
- [`@deck.gl-community/bing-maps`](../../../bing-maps/README.md) and its
  [`DeckOverlay`](../../../bing-maps/api-reference/deck-overlay.md)

[Using with maps](../using-with-maps.md) describes the behavior shared by every overlay root. The
[DeckGL API](../../api-reference/deckgl.md#custom-compatible-overlays) defines the factory options.

## Overlay requirements

The factory accepts any overlay that implements deck.gl's `setProps` and `finalize` lifecycle:

- `setProps(props)` receives the root's deck.gl props on every change, including the `layers`
  produced by JSX `<layer>` children. It can run before the overlay is attached to its host.
- `finalize()` runs when the root unmounts or recreates the overlay. It releases the overlay's
  deck.gl resources. `MapboxOverlay` and `MapLibreOverlay` also detach themselves from the map in
  `finalize`.

An overlay that lacks one of these methods, or whose `finalize` does not release its resources,
needs a subclass or wrapper that adds it before it can be used with `createDeckGL`.

## Create the root

Create the component once, at module scope, never during render. Creating it during render makes
React remount the root on every render.

```tsx
import {createDeckGL} from '@deck.gl-community/react-fiber';

const DeckGL = createDeckGL({
  createExternalOverlay: props => new MyCompatibleOverlay({...props})
});
```

The factory runs only when the root is first configured, with the root's props. Later changes
reach the overlay through `setProps`. If the overlay reads some props only at construction, list
them in `recreateOnChange` so that a change finalizes the overlay and calls the factory again.

## Attach to the host

The root does not attach the overlay; the application does, with the host's own API. Follow the
lifecycle in [Attach the overlay to the host map](../using-with-maps.md#attach-the-overlay-to-the-host-map):
store the instance from `onDeckglChange` in state, attach it once per instance in an effect after
the host map is ready, and detach it in the effect's cleanup. The Mapbox and MapLibre guides show
this pattern with `map.addControl` and `map.removeControl`.

The host map owns the camera and views. Do not pass `viewState`, `initialViewState`, `controller`,
or JSX `<view>` descriptors to a custom overlay root.
