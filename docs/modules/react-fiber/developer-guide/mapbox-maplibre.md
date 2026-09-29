# Mapbox and MapLibre integration

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

Both provider roots accept `interleaved?: boolean` when they are first created:

- Omit it, or pass `false`, for the provider overlay's default dedicated deck canvas.
- Pass `true` to share the map's WebGL context.

The mode is fixed when the overlay is constructed. To change it, remount `DeckGL` with a different
React `key`. It does not select the provider; select Mapbox or MapLibre through the import path.

Provider roots render no host DOM node. You can place them inside a React Map GL `<Map>`, or beside
a manual `new Map({container})` integration without adding a child to the map container. JSX
`<view>` descriptors do not configure an external overlay because the host map owns views.

## Attach the control safely

The lifecycle has four steps:

1. Create the host map with its provider-specific options.
2. Receive the matching overlay through `onDeckglChange`.
3. After the map is ready, add that exact overlay once with `map.addControl`.
4. During cleanup, remove the control only if it was attached, then destroy the map if the
   application created it.

The cleanup must handle React Strict Mode and unmount-before-load. Track both disposal and whether
`addControl` ran, cancel the pending load callback, and never remove a control that was not added.

## Mapbox

Install the provider integration and the host SDK:

```bash
yarn add @deck.gl/mapbox mapbox-gl
```

### React Map GL

Give Mapbox options to React Map GL. The effect adds the `MapboxOverlay` only after both the map
and overlay are available.

```tsx
import {useEffect, useRef, useState} from 'react';
import Map, {type MapRef} from 'react-map-gl/mapbox';
import type {MapboxOverlay} from '@deck.gl/mapbox';
import {DeckGL} from '@deck.gl-community/react-fiber/mapbox';

export function MapboxMap() {
  const mapRef = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [overlay, setOverlay] = useState<MapboxOverlay | null>(null);

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
      mapboxAccessToken={import.meta.env.VITE_MAPBOX_ACCESS_TOKEN}
      mapStyle="mapbox://styles/mapbox/standard"
      initialViewState={{longitude: -122.4, latitude: 37.8, zoom: 12}}
      onLoad={() => setLoaded(true)}
    >
      <DeckGL interleaved onDeckglChange={setOverlay}>
        {/* React Fiber <layer> elements */}
      </DeckGL>
    </Map>
  );
}
```

For interleaved rendering, use `beforeId` to position deck layers relative to a Mapbox style
layer. With Mapbox Standard, use the provider's `slot` support when it fits the style. Configure
antialiasing and other map-owned WebGL settings on the Mapbox map.

### Manual map

When constructing a map directly, use a ref as the container. The provider root returns no DOM
node, so the container remains valid for Mapbox.

```tsx
import {useEffect, useRef, useState} from 'react';
import mapboxgl from 'mapbox-gl';
import type {MapboxOverlay} from '@deck.gl/mapbox';
import {DeckGL} from '@deck.gl-community/react-fiber/mapbox';

export function ManualMapboxMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [overlay, setOverlay] = useState<MapboxOverlay | null>(null);

  useEffect(() => {
    if (!containerRef.current || !overlay) return;

    const map = new mapboxgl.Map({
      accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN,
      container: containerRef.current,
      center: [-122.4, 37.8],
      style: 'mapbox://styles/mapbox/standard',
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

## MapLibre

Install the provider integration and the host SDK:

```bash
yarn add @deck.gl/maplibre maplibre-gl
```

Configure the MapLibre worker before constructing any map in a bundled application. The exact
worker import is bundler-specific. For Vite's CSP worker build, configure it in client-only code:

```tsx
import maplibregl from 'maplibre-gl';
import MapLibreWorker from 'maplibre-gl/dist/maplibre-gl-csp-worker?worker';

maplibregl.setWorkerClass(MapLibreWorker);
```

Do not run this setup during server rendering. In a Next.js or TanStack Start application, place
it behind a client boundary or in the map module that runs only in the browser.

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

MapLibre interleaved rendering requires WebGL2 and supports one interleaved overlay per map. Use
`beforeId` to position deck layers. In shared-context mode, configure MSAA and pixel ratio on the
host map with `canvasContextAttributes.antialias` and `pixelRatio`; deck's `useDevicePixels` and
`device` do not control that context.

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

## Provider prop boundary

The provider root accepts supported deck.gl and overlay props, including layers, effects,
picking callbacks, layer filtering, parameters, and `interleaved`. Do not pass map-owned values
to it. `canvas`, `parent`, `device`, `viewState`, `initialViewState`, and `controller` belong to
the host map. The MapLibre overlay also excludes `width`, `height`, and `gl`.

Use a standalone root when the application needs `Deck` and its canvas. For a compatible custom
overlay, use the native `createDeckGL` factory instead of trying to select a provider at render
time.
