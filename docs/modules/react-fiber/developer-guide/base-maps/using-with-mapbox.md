# Using with Mapbox

| Import path | deck.gl overlay | Overlaid | Interleaved | React Map GL |
| --- | --- | --- | --- | --- |
| `@deck.gl-community/react-fiber/mapbox` | [`MapboxOverlay`](https://deck.gl/docs/api-reference/mapbox/mapbox-overlay) | ✓ | ✓ | ✓ |

[Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/api/) is a JavaScript library for building web
maps. The `/mapbox` provider root creates a
[`MapboxOverlay`](https://deck.gl/docs/api-reference/mapbox/mapbox-overlay) from
[`@deck.gl/mapbox`](https://deck.gl/docs/api-reference/mapbox/overview) and renders its JSX
`<layer>` children into it. The application owns the Mapbox map and attaches the overlay to it.
[Using with maps](../using-with-maps.md) describes the shared provider-root behavior and lifecycle.

deck.gl's [Using with Mapbox](https://deck.gl/docs/developer-guide/base-maps/using-with-mapbox)
guide covers the same integration without React Fiber.

## Integration modes

- **Interleaved:** pass `interleaved` to render deck.gl layers into the Mapbox WebGL2 context. See
  deck.gl's
  [interleaved mode](https://deck.gl/docs/developer-guide/base-maps/using-with-mapbox#interleaved)
  description, including its compatibility and limitations.
- **Overlaid:** omit `interleaved`, or pass `false`, to render deck.gl into its own canvas inside
  the Mapbox controls container. See deck.gl's
  [overlaid mode](https://deck.gl/docs/developer-guide/base-maps/using-with-mapbox#overlaid)
  description.
- **Reverse controlled:** provider roots do not support this mode. See
  [Using with maps](../using-with-maps.md#reverse-controlled-maps).

For interleaved rendering, use `beforeId` to position deck layers relative to a Mapbox style
layer. With Mapbox Standard, use the provider's `slot` support when it fits the style. Configure
antialiasing and other map-owned WebGL settings on the Mapbox map.

## Install

Install the provider integration and the host SDK:

```bash
yarn add @deck.gl/mapbox mapbox-gl
```

## Examples

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

## Additional information

### React Map GL

deck.gl's guide attaches `MapboxOverlay` with React Map GL's `useControl` hook. Do not use
`useControl` with a provider root: its factory runs once when the hook mounts, but the provider
root creates the overlay itself and delivers it later through `onDeckglChange`. Attach the overlay
in an effect, as in the example above.

### Mapbox token and alternatives

Mapbox GL JS requires a Mapbox access token. deck.gl's guide explains how to
[provide the token](https://deck.gl/docs/developer-guide/base-maps/using-with-mapbox#mapbox-token)
and lists
[alternatives to the Mapbox base map service](https://deck.gl/docs/developer-guide/base-maps/using-with-mapbox#alternatives-to-mapbox-basemap-sevice),
including [MapLibre](./using-with-maplibre.md).
