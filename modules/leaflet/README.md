# @deck.gl-community/leaflet

This module allows [deck.gl](https://deck.gl) to be used as a Leaflet custom layer.

## Installation

```bash
npm install deck.gl @deck.gl-community/leaflet leaflet
```

## Usage

```js
import {DeckLayer} from '@deck.gl-community/leaflet';
import {MapView} from '@deck.gl/core';
import {GeoJsonLayer, ArcLayer} from '@deck.gl/layers';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// source: Natural Earth http://www.naturalearthdata.com/ via geojson.xyz
const AIR_PORTS =
  'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_10m_airports.geojson';

// Create map
const map = L.map(document.getElementById('map'), {
  center: [51.47, 0.45],
  zoom: 4,
});
L.tileLayer('https://tiles.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png', {
  maxZoom: 22,
  attribution:
    '© <a href="https://carto.com/about-carto/" target="_blank" rel="noopener">CARTO</a>, © <a href="http://www.openstreetmap.org/about/" target="_blank">OpenStreetMap</a> contributors',
}).addTo(map);

// Add deck.gl overlay
const deckLayer = new DeckLayer({
  views: [
    new MapView({ repeat: true }),
  ],
  layers: [
    new GeoJsonLayer({
      id: 'airports',
      data: AIR_PORTS,
      // Styles
      filled: true,
      pointRadiusMinPixels: 2,
      pointRadiusScale: 2000,
      getPointRadius: (f) => 11 - f.properties.scalerank,
      getFillColor: [200, 0, 80, 180],
      // Interactive props
      pickable: true,
      autoHighlight: true,
      onClick: (info) =>
        // eslint-disable-next-line
        info.object && alert(`${info.object.properties.name} (${info.object.properties.abbrev})`)
    }),
    new ArcLayer({
      id: 'arcs',
      data: AIR_PORTS,
      dataTransform: (d: any) => d.features.filter((f) => f.properties.scalerank < 4),
      // Styles
      getSourcePosition: (f) => [-0.4531566, 51.4709959], // London
      getTargetPosition: (f) => f.geometry.coordinates,
      getSourceColor: [0, 128, 200],
      getTargetColor: [200, 0, 80],
      getWidth: 1
    })
  ],
  getTooltip: (info) => info.object && info.object.properties.name
});
map.addLayer(deckLayer);
```

## API Reference

### DeckLayer

An implementation of [L.Layer](https://leafletjs.com/reference.html#layer).

```js
const deckLayer = new DeckLayer({
  views: [
    new MapView({ repeat: true }),
  ],
  layers: [...],
});
map.addLayer(deckLayer);
```

The constructor accepts a props object that is passed to the [Deck](https://deck.gl/docs/api-reference/core/deck) constructor. See the [limitations](#supported-features-and-limitations) section below for more details.

The following [Deck methods](https://deck.gl/docs/api-reference/core/deck#methods) can be called directly from a `DeckLayer` instance:

- `deckLayer.setProps`
- `deckLayer.pickObject`
- `deckLayer.pickMultipleObjects`
- `deckLayer.pickObjects`

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
