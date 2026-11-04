# DeckGL

![From v9.4](https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square)

```tsx
import {DeckGL} from '@deck.gl-community/react-fiber';
import type {DeckGLProps, OnDeckChange} from '@deck.gl-community/react-fiber';
```

The root import creates only a standalone `Deck`. It owns a canvas unless the caller supplies `canvas`, and sends JSX `<view>` descriptors to deck.gl, merged with the `views` prop as [Native elements](./native-elements.md#mixing-jsx-and-direct-views) describes. Its props are `DeckProps`, which has no `interleaved` option.

## Provider roots

Choose an external overlay by import path, not by a runtime provider-selection prop:

```tsx
import {DeckGL as MapboxDeckGL} from '@deck.gl-community/react-fiber/mapbox';
import {DeckGL as MapLibreDeckGL} from '@deck.gl-community/react-fiber/maplibre';
```

`/mapbox` always creates `MapboxOverlay`; `/maplibre` always creates `MapLibreOverlay`. They pass `interleaved` to the overlay unchanged, so the overlay's own default applies: `false` for [`MapboxOverlay`](https://deck.gl/docs/api-reference/mapbox/mapbox-overlay#constructor) and [`MapLibreOverlay`](https://deck.gl/docs/api-reference/maplibre/overview). Both overlays read `interleaved` only in their constructors. When the prop changes, the root finalizes the current overlay, which removes it from the map, and creates a new one. `onDeckChange` receives `null` and then the new instance, which the application attaches. Provider roots render no host DOM node and use a detached internal registry key, so they are safe inside a map container that must remain child-free.

Each provider entry point exposes its concrete overlay contract:

| Entry point | Props and instance |
| --- | --- |
| Root | `DeckGLProps`; the instance is `Deck` |
| `/mapbox` | `MapboxDeckGLProps`; `onDeckChange` receives `MapboxOverlay \| null` |
| `/maplibre` | `MapLibreDeckGLProps`; `onDeckChange` receives `MapLibreOverlay \| null` |

Provider overlay props exclude map-owned configuration such as `canvas`, `parent`, `device`, `viewState`, `initialViewState`, and `controller`. The MapLibre provider also excludes `width`, `height`, and `gl`. Configure those options on the application-owned Mapbox or MapLibre map, then attach the instance from `onDeckChange` with `map.addControl` and remove the same control during cleanup. JSX `<view>` descriptors are not forwarded to external overlays because the host map owns views. See [Using with maps](../developer-guide/using-with-maps.md) for complete attachment and shared-context guidance.

## Props and lifecycle

`DeckGLProps` is the standalone `DeckProps` surface plus React children and `onDeckChange`; the instance is `Deck`. Provider entry points infer their concrete overlay instance in `onDeckChange`.

The notification runs after configuration and receives `null` during cleanup. It is a lifecycle notification rather than a callback ref: replacing only its identity does not recreate the root, but later notifications use the replacement.

On the standalone root, `canvas` accepts an `HTMLCanvasElement` or the id of a `<canvas>` element. An id is resolved with `document.getElementById` on the client after mount, so the canvas may be rendered in the same commit as `DeckGL`. An id that does not name a mounted `<canvas>` throws. Without `parent`, deck.gl uses the canvas's parent element. The root binds to the element found at mount; to bind a replacement element that reuses the id, pass that element as `canvas` or remount with a different React `key`.

Deck event properties such as `onClick` remain deck.gl callbacks, not React synthetic events on `<layer>` or `<view>`.

`debug` is a deck.gl prop and is passed to `Deck` or the overlay unchanged. Warnings and traces go through deck.gl's `log`: root creation, unmounting and each commit log at level 3, and configured props at level 4. Enable them in the browser console with `deck.log.enable()` and `deck.log.level = 3`; see [Debugging](https://deck.gl/docs/developer-guide/debugging).

## Root DOM and sizing

Without a `canvas` prop, the standalone root renders the same wrapper and canvas as `@deck.gl/react`:

```html
<div id="deckgl-wrapper" style="position: absolute; z-index: 0; left: 0; top: 0; width: 100%; height: 100%">
  <canvas id="deckgl-overlay" style="left: 0; top: 0"></canvas>
</div>
```

The ids derive from the `id` prop: `id="map"` renders `map-wrapper` and a canvas with id `map`. Give each root a distinct `id` when a page has more than one. The wrapper fills its nearest positioned ancestor by default. `width` and `height` size the wrapper, `style` applies to the wrapper except `mixBlendMode`, which applies to the canvas, and the canvas fills the wrapper. With a caller-supplied `canvas`, the root renders no DOM and forwards `width`, `height`, and `style` to deck.gl unchanged. Provider roots never render DOM.

## Custom compatible overlays

For a compatible overlay not covered by the provider roots, bind its factory once:

```tsx
import {createDeckGL} from '@deck.gl-community/react-fiber';

const DeckGL = createDeckGL({
  createExternalOverlay: props => new MyCompatibleOverlay(props)
});
```

The factory runs only when the root is initially configured. It is not a render prop and never reaches `setProps`. The result must implement deck.gl's `setProps` and `finalize` lifecycle. See [Using with custom overlays](../developer-guide/base-maps/using-with-custom-overlays.md) for the overlay requirements and host attachment.

`recreateOverlayOnChange` lists props that the overlay reads only at construction or attach time. When one of them changes (compared with `Object.is`), the component finalizes the overlay and calls the factory again with the full props. `onDeckChange` receives `null` and then the new instance. The provider roots declare `recreateOverlayOnChange: ['interleaved']`.

```tsx
const DeckGL = createDeckGL({
  createExternalOverlay: props => new MyCompatibleOverlay(props),
  recreateOverlayOnChange: ['interleaved']
});
```

Recreating an overlay discards its internal state, such as the hovered object.

## Advanced reconciler APIs

`@deck.gl-community/react-fiber/reconciler` exports `createRoot` and `unmountAtNode` for direct integration. These are advanced APIs; normal applications should use one of the entry points above.
