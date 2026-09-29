# DeckGL

```tsx
import {DeckGL} from '@deck.gl-community/react-fiber';
import type {DeckglInstance, DeckglProps, OnDeckglChange} from '@deck.gl-community/react-fiber';
```

The root import creates only a standalone `Deck`. It owns a canvas unless the caller supplies `canvas`, sends JSX `<view>` descriptors to deck.gl, and rejects `interleaved` at both type-check and runtime.

## Provider roots

Choose an external overlay by import path, not by a runtime provider-selection prop:

```tsx
import {DeckGL as MapboxDeckGL} from '@deck.gl-community/react-fiber/mapbox';
import {DeckGL as MapLibreDeckGL} from '@deck.gl-community/react-fiber/maplibre';
```

`/mapbox` always creates `MapboxOverlay`; `/maplibre` always creates `MapLibreOverlay`. Their `interleaved` boolean selects the overlay mode and defaults to `false`. It is fixed at construction: remount with a different React `key` to change it. Provider roots render no host DOM node and use a detached internal registry key, so they are safe inside a map container that must remain child-free.

Provider overlay props exclude map-owned configuration such as `canvas`, `parent`, `device`, `viewState`, `initialViewState`, and `controller`. Configure those options on the application-owned Mapbox or MapLibre map, then attach the instance from `onDeckglChange` with `map.addControl` and remove the same control during cleanup. JSX `<view>` descriptors are not forwarded to external overlays because the host map owns views.

## Props and lifecycle

`DeckglProps` is the standalone `DeckProps` surface plus React children and `onDeckglChange`; `DeckglInstance` is `Deck`. Provider entry points infer their concrete overlay instance in `onDeckglChange`.

The notification runs after configuration and receives `null` during cleanup. It is a lifecycle notification rather than a callback ref: replacing only its identity does not recreate the root, but later notifications use the replacement.

Deck event properties such as `onClick` remain deck.gl callbacks, not React synthetic events on `<layer>` or `<view>`.

## Custom compatible overlays

For a compatible overlay not covered by the provider roots, bind its factory once:

```tsx
import {createDeckGL} from '@deck.gl-community/react-fiber';

const DeckGL = createDeckGL({
  createExternalOverlay: props => new MyCompatibleOverlay(props)
});
```

The factory runs only when the root is initially configured. It is not a render prop, never reaches `setProps`, and cannot replace an established instance. The result must implement deck.gl's `setProps` and `finalize` lifecycle.

## Advanced reconciler APIs

`@deck.gl-community/react-fiber/reconciler` exports `createRoot` and `unmountAtNode` for direct integration. These are advanced APIs; normal applications should use one of the entry points above.
