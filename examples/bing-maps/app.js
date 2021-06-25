/* global document, process */
import {loadModule} from 'deck.gl-bing-maps';
import {GeoJsonLayer, ArcLayer} from 'deck.gl';

// set your Bing Maps API key here
const BING_MAPS_API_KEY = process.env.BingMapsAPIKey; // eslint-disable-line

// source: Natural Earth http://www.naturalearthdata.com/ via geojson.xyz
const AIR_PORTS =
  'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_10m_airports.geojson';

loadModule().then(({Map, MapTypeId, Location, DeckOverlay}) => {
  // Create map
  const map = new Map(document.getElementById('map'), {
    credentials: BING_MAPS_API_KEY,
    supportedMapTypes: [MapTypeId.aerial, MapTypeId.canvasLight, MapTypeId.canvasDark],
    disableBirdsEye: true,
    disableStreetside: true
  });

  map.setView({
    center: new Location(51.47, 0.45),
    zoom: 4
  });

  // Add deck.gl overlay
  const deckOverlay = new DeckOverlay({
    layers: [
      new GeoJsonLayer({
        id: 'airports',
        data: AIR_PORTS,
        // Styles
        filled: true,
        pointRadiusMinPixels: 2,
        pointRadiusScale: 2000,
        getRadius: f => 11 - f.properties.scalerank,
        getFillColor: [200, 0, 80, 180],
        // Interactive props
        pickable: true,
        autoHighlight: true,
        onClick: info =>
          // eslint-disable-next-line
          info.object && alert(`${info.object.properties.name} (${info.object.properties.abbrev})`)
      }),
      new ArcLayer({
        id: 'arcs',
        data: AIR_PORTS,
        dataTransform: d => d.features.filter(f => f.properties.scalerank < 4),
        // Styles
        getSourcePosition: f => [-0.4531566, 51.4709959], // London
        getTargetPosition: f => f.geometry.coordinates,
        getSourceColor: [0, 128, 200],
        getTargetColor: [200, 0, 80],
        getWidth: 1
      })
    ],
    getTooltip: info => info.object && info.object.properties.name
  });
  map.layers.insert(deckOverlay);
});
