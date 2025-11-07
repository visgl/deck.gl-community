# Overview

:::danger
The deck.gl-community repo is specifically set up to collect useful code that no longer has dedicated maintainers. This means that there is often no one who can respond quickly to issues. The vis.gl / Open Visualization team members who try to keep this running can only put a few hours into it every now and then. It is important to understand this limitation. If your project depends on timely fixes, and you are not able to contribute them yourself, deck.gl-community modules may not be the right choice for you.
:::

This module allows [deck.gl](https://deck.gl) to be used as a Bing Maps custom layer.

## Installation

```bash
npm install deck.gl @deck.gl-community/bing-maps
```

## Usage

```ts
import {loadModules} from '@deck.gl-community/bing-maps';
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
        data: 'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_admin_0_scale_rank.geojson',
        lineWidthMinPixels: 2,
        getLineColor: [60, 60, 60],
        getFillColor: [200, 200, 200]
      })
    ]
  });
  map.layers.insert(deckOverlay);
});
```
