# Using with MapLibre

| Import path | deck.gl overlay | Overlaid | Interleaved | React Map GL |
| --- | --- | --- | --- | --- |
| `@deck.gl-community/react-fiber/maplibre` | [`MapLibreOverlay`](https://deck.gl/docs/api-reference/maplibre/overview) | ✓ | ✓ | ✓ |

[MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) is an open-source library that renders
interactive maps from vector tiles. The `/maplibre` provider root creates a
[`MapLibreOverlay`](https://deck.gl/docs/api-reference/maplibre/overview) from
[`@deck.gl/maplibre`](https://deck.gl/docs/api-reference/maplibre/overview) and renders its JSX
`<layer>` children into it. The application owns the MapLibre map and attaches the overlay to it.
[Using with maps](../using-with-maps.md) describes the shared provider-root behavior and lifecycle.

deck.gl's [Using with MapLibre](https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre)
guide covers the same integration without React Fiber.

## Integration modes

- **Interleaved:** pass `interleaved` to render deck.gl layers into the MapLibre WebGL2 context.
  See deck.gl's
  [interleaved mode](https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre#interleaved)
  description.
- **Overlaid:** omit `interleaved`, or pass `false`, to render deck.gl into its own canvas inside
  the MapLibre controls container. See deck.gl's
  [overlaid mode](https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre#overlaid)
  description.
- **Reverse controlled:** provider roots do not support this mode. See
  [Using with maps](../using-with-maps.md#reverse-controlled-maps).

MapLibre interleaved rendering requires WebGL2 and supports one interleaved overlay per map. Use
`beforeId` to position deck layers. In shared-context mode, configure MSAA and pixel ratio on the
host map with `canvasContextAttributes.antialias` and `pixelRatio`; deck's `useDevicePixels` and
`device` do not control that context.

The MapLibre overlay excludes `width`, `height`, and `gl` in addition to the map-owned props listed
in [Provider prop boundary](../using-with-maps.md#provider-prop-boundary).

## Install

Install the provider integration and the host SDK:

```bash
yarn add @deck.gl/maplibre maplibre-gl
```

Keep map creation in client-only code: in a Next.js or TanStack Start application, use a client
boundary or a module that runs only in the browser.

## Configure the MapLibre worker

MapLibre GL JS 6 ships as ES modules and runs its tile parsing in a separate worker module. A
bundled application tells MapLibre where the bundler emitted that worker: call `setWorkerUrl(url)`
once, in browser code, before it creates the first map. This applies to MapLibre only; Mapbox needs
no worker setup.

With Vite, including React Router and TanStack Start, import the worker with Vite's `?worker&url`
query:

```ts
import {setWorkerUrl} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);
```

The `?worker&url` query is Vite-only. Next.js (Turbopack or webpack) and other bundlers use
`new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url)` instead, which requires
`maplibre-gl` 6.13 or later. MapLibre's
[installation guide](https://maplibre.org/maplibre-gl-js/docs/#installation) lists the setup for
each bundler.

The React Fiber examples configure the worker in their MapLibre modules:

- [Vite](https://github.com/visgl/deck.gl-community/blob/master/examples/react-fiber/vite/src/modules/map/maplibre.ts)
- [React Router](https://github.com/visgl/deck.gl-community/blob/master/examples/react-fiber/react-router/app/modules/map/maplibre.ts)
- [TanStack Start](https://github.com/visgl/deck.gl-community/blob/master/examples/react-fiber/tanstack-start/app/modules/map/maplibre.ts)
- [Next.js](https://github.com/visgl/deck.gl-community/blob/master/examples/react-fiber/nextjs/src/modules/map/maplibre.ts)

MapLibre loads a same-origin worker URL directly, so a Content Security Policy needs only
`worker-src 'self'`. A cross-origin worker URL, such as one served from a CDN, is wrapped in a
`blob:` URL and needs `blob:` in `worker-src`. See MapLibre's
[CSP directives](https://maplibre.org/maplibre-gl-js/docs/#csp-directives) for the full list.

## Examples

### React Map GL

The React Map GL MapLibre component owns all MapLibre options. It can contain provider `DeckGL`
because that component does not render a host child.

```tsx
import {useEffect, useRef, useState} from 'react';
import {Map, type MapRef} from 'react-map-gl/maplibre';
import type {MapLibreOverlay} from '@deck.gl/maplibre';
import {DeckGL} from '@deck.gl-community/react-fiber/maplibre';

export function MapLibreMap() {
  const mapRef = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [overlay, setOverlay] = useState<MapLibreOverlay | null>(null);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !loaded || !overlay) return;

    let attached = false;
    map.addControl(overlay);
    attached = true;

    return () => {
      if (attached) map.removeControl(overlay);
    };
  }, [loaded, overlay]);

  return (
    <Map
      ref={mapRef}
      mapStyle="https://demotiles.maplibre.org/style.json"
      initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}}
      canvasContextAttributes={{antialias: true}}
      pixelRatio={window.devicePixelRatio}
      onLoad={() => setLoaded(true)}
    >
      <DeckGL interleaved onDeckglChange={setOverlay}>
        {/* React Fiber <layer> elements */}
      </DeckGL>
    </Map>
  );
}
```

### Manual map

A manual MapLibre container must have no children before `new Map({container})`. The detached
provider-root registry key preserves that requirement.

```tsx
import {useEffect, useRef, useState} from 'react';
import {Map as MapLibreMap} from 'maplibre-gl';
import type {MapLibreOverlay} from '@deck.gl/maplibre';
import {DeckGL} from '@deck.gl-community/react-fiber/maplibre';

export function ManualMapLibreMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [overlay, setOverlay] = useState<MapLibreOverlay | null>(null);

  useEffect(() => {
    if (!containerRef.current || !overlay) return;

    const map = new MapLibreMap({
      canvasContextAttributes: {antialias: true},
      container: containerRef.current,
      center: [-122.4, 37.8],
      pixelRatio: window.devicePixelRatio,
      style: 'https://demotiles.maplibre.org/style.json',
      zoom: 12
    });
    let disposed = false;
    let attached = false;

    const attachOverlay = () => {
      if (!disposed) {
        map.addControl(overlay);
        attached = true;
      }
    };

    if (map.loaded()) {
      attachOverlay();
    } else {
      map.once('load', attachOverlay);
    }

    return () => {
      disposed = true;
      map.off('load', attachOverlay);
      if (attached) map.removeControl(overlay);
      map.remove();
    };
  }, [overlay]);

  return (
    <div ref={containerRef} style={{height: 500}}>
      <DeckGL interleaved onDeckglChange={setOverlay}>
        {/* React Fiber <layer> elements */}
      </DeckGL>
    </div>
  );
}
```

## Additional information

### React Map GL

deck.gl's guide attaches `MapLibreOverlay` with React Map GL's `useControl` hook. Do not use
`useControl` with a provider root: its factory runs once when the hook mounts, but the provider
root creates the overlay itself and delivers it later through `onDeckglChange`. Attach the overlay
in an effect, as in the example above.

### Choosing a map tile service

MapLibre GL JS renders tiles from any compatible service or from tiles you host. deck.gl's guide
lists [tile services and self-hosting resources](https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre#choosing-a-map-tile-service).
