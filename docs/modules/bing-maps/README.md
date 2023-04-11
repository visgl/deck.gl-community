# Overview

This module allows [deck.gl](https://deck.gl) to be used as a Bing Maps custom layer.

## Installation

```bash
npm install deck.gl deck.gl-bing-maps
```

## Usage

```js
import {loadModules} from 'deck.gl-bing-maps';
import {GeoJsonLayer} from 'deck.gl';

loadModules().then(({Maps, Location, DeckOverlay}) => {
  // Create map
  const map = new Map(document.getElementById('map'), {
    credentials: 'YOUR_API_KEY',
    // Disable modes that are not supported
    disableBirdsEye: true,
    disableStreetside: true
  });

  map.setView({
    center: new Location(37.78, -122.45),
    zoom: 10
  });

  // Add deck.gl overlay
  const deckOverlay = new DeckOverlay({
    layers: [
      new GeoJsonLayer({
        data:
          'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_admin_0_scale_rank.geojson',
        lineWidthMinPixels: 2,
        getLineColor: [60, 60, 60],
        getFillColor: [200, 200, 200]
      })
    ]
  });
  map.layers.insert(deckOverlay);
});
```

## API Reference

### loadModules

`loadModules(moduleNames)`

Arguments:

- `moduleNames` (`string[]?`) - Optional modules to load, e.g. `'Microsoft.Maps.GeoJson'`, `'Microsoft.Maps.DrawingTools'`

Returns a Promise that resolves to the global `Microsoft.Maps` namespace. A custom class, `DeckOverlay`, is also added to the namespace.

### DeckOverlay

An implementation of [CustomOverlay](https://docs.microsoft.com/en-us/bingmaps/v8-web-control/map-control-api/customoverlay-class).

```js
const deckOverlay = new DeckOverlay({...});
map.layers.insert(deckOverlay);
```

The constructor accepts a props object that is passed to the [Deck](https://deck.gl/docs/api-reference/core/deck) constructor. See the [limitations](#supported-features-and-limitations) section below for more details.

The following [Deck methods](https://deck.gl/docs/api-reference/core/deck#methods) can be called directly from a `DeckOverlay` instance:

- `deckOverlay.setProps`
- `deckOverlay.pickObject`
- `deckOverlay.pickMultipleObjects`
- `deckOverlay.pickObjects`
- `deckOverlay.redraw`
- `deckOverlay.finalize`

## Supported Features and Limitations

Supported deck.gl features:

- Layers
- Effects
- Auto-highlighting
- Attribute transitions
- `onHover` and `onClick` callbacks
- Tooltip

Not supported features:

- Tilting
- Multiple views
- Controller
- React integration
- Gesture event callbacks (e.g. `onDrag*`)
