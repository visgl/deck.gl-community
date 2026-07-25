// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  AmbientLight,
  Deck,
  DirectionalLight,
  LightingEffect,
  MapView,
  type MapViewState
} from '@deck.gl/core';
import {GeoJsonLayer, ScatterplotLayer, TextLayer} from '@deck.gl/layers';
import {
  createWindField,
  DelaunayCoverLayer,
  ElevationLayer,
  parseWindData,
  ParticleLayer,
  sampleWindField,
  WindLayer,
  type WindField,
  type WindStation
} from '@deck.gl-community/geo-layers';

const WIND_DATA_ROOT = 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/wind';
const US_STATE_BOUNDARIES =
  'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json';
const ELEVATION_BOUNDS: [number, number, number, number] = [-125, 24.4, -66.7, 49.6];
const ELEVATION_SCALE = 80;
const INITIAL_VIEW_STATE: MapViewState = {
  longitude: -98.319,
  latitude: 37.614,
  zoom: 4.05,
  pitch: 46,
  bearing: -0.64,
  minPitch: 0,
  maxPitch: 85
};

type WindCity = {name: string; position: [number, number]};

const WIND_CITIES: WindCity[] = [
  {name: 'Seattle', position: [-122.332, 47.606]},
  {name: 'Portland', position: [-122.676, 45.523]},
  {name: 'Boise', position: [-116.202, 43.615]},
  {name: 'Missoula', position: [-113.995, 46.873]},
  {name: 'Billings', position: [-108.5, 45.783]},
  {name: 'San Francisco', position: [-122.419, 37.775]},
  {name: 'Los Angeles', position: [-118.244, 34.052]},
  {name: 'Las Vegas', position: [-115.14, 36.17]},
  {name: 'Salt Lake City', position: [-111.891, 40.761]},
  {name: 'Phoenix', position: [-112.074, 33.448]},
  {name: 'Albuquerque', position: [-106.65, 35.084]},
  {name: 'Denver', position: [-104.99, 39.739]},
  {name: 'Cheyenne', position: [-104.82, 41.14]},
  {name: 'Omaha', position: [-95.998, 41.256]},
  {name: 'Minneapolis', position: [-93.265, 44.978]},
  {name: 'Kansas City', position: [-94.578, 39.1]},
  {name: 'Dallas', position: [-96.797, 32.776]},
  {name: 'Austin', position: [-97.743, 30.267]},
  {name: 'Houston', position: [-95.37, 29.76]},
  {name: 'Chicago', position: [-87.63, 41.878]},
  {name: 'Nashville', position: [-86.781, 36.163]},
  {name: 'Atlanta', position: [-84.388, 33.749]},
  {name: 'Washington', position: [-77.037, 38.907]},
  {name: 'New York', position: [-74.006, 40.713]}
];

const WIND_LIGHTING = new LightingEffect({
  ambient: new AmbientLight({color: [194, 210, 235], intensity: 0.8}),
  sunlight: new DirectionalLight({
    color: [255, 226, 198],
    intensity: 1.7,
    direction: [-1, -2, -2]
  }),
  fill: new DirectionalLight({
    color: [125, 170, 223],
    intensity: 0.5,
    direction: [2, 1, -1]
  })
});

/** Options accepted by the standalone and embedded historical wind showcase. */
export type WindExampleOptions = {
  /** Receives the initialized deck instance when the website manages GPU devices. */
  onDeckInitialized?: (deck: Deck) => void;
  /** Overrides the original public wind showcase dataset location. */
  dataUrl?: string;
};

type WindSettings = {
  showParticles: boolean;
  showWind: boolean;
  showTerrain: boolean;
  showStationMesh: boolean;
  showStations: boolean;
};

async function loadWindField(dataUrl: string, signal: AbortSignal): Promise<WindField> {
  const [stationsResponse, weatherResponse] = await Promise.all([
    fetch(`${dataUrl}/stations.json`, {signal}),
    fetch(`${dataUrl}/weather.bin`, {signal})
  ]);
  if (!stationsResponse.ok) {
    throw new Error(`Could not load wind stations: ${stationsResponse.status}.`);
  }
  if (!weatherResponse.ok) {
    throw new Error(`Could not load wind measurements: ${weatherResponse.status}.`);
  }

  const [stations, weather] = await Promise.all([
    stationsResponse.json() as Promise<WindStation[]>,
    weatherResponse.arrayBuffer()
  ]);
  return createWindField(stations, parseWindData(weather, stations.length));
}

/** Turns the original grayscale elevation map into a dark, transparent terrain texture. */
async function loadTerrainTexture(dataUrl: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(`${dataUrl}/elevation.png`, {signal});
  if (!response.ok) {
    throw new Error(`Could not load terrain elevation: ${response.status}.`);
  }

  const image = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) {
    image.close();
    throw new Error('Could not initialize the wind terrain texture.');
  }

  context.drawImage(image, 0, 0);
  image.close();
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const {data} = imageData;
  for (let offset = 0; offset < data.length; offset += 4) {
    const height = data[offset];
    data[offset] = 20 + Math.round(height * 0.15);
    data[offset + 1] = 30 + Math.round(height * 0.19);
    data[offset + 2] = 43 + Math.round(height * 0.22);
    data[offset + 3] = height > 2 ? 245 : 0;
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function createSettingsPanel(settings: WindSettings, onChange: () => void): HTMLElement {
  const panel = document.createElement('section');
  panel.style.cssText =
    'position:absolute;top:18px;left:18px;z-index:1;width:min(286px,calc(100% - 36px));' +
    'padding:17px 19px;border:1px solid rgba(192,230,217,.2);border-radius:14px;' +
    'background:rgba(10,20,31,.84);color:#e8f7f0;font:13px/1.6 system-ui,sans-serif;' +
    'backdrop-filter:blur(14px);box-shadow:0 14px 42px rgba(0,0,0,.24)';

  const title = document.createElement('h2');
  title.textContent = 'Wind over the United States';
  title.style.cssText = 'margin:0 0 4px;font-size:17px;font-weight:650;letter-spacing:-.02em';
  panel.append(title);

  const description = document.createElement('p');
  description.textContent =
    'The original Nicolas Belmonte showcase, rebuilt from reusable deck.gl community layers. Right-drag or control-drag to tilt and rotate.';
  description.style.cssText = 'margin:0 0 13px;color:rgba(232,247,240,.72)';
  panel.append(description);

  const controls: [keyof WindSettings, string][] = [
    ['showParticles', 'Animated wind particles'],
    ['showWind', 'Filled wind-direction arrows'],
    ['showTerrain', 'Extruded 3D mountain terrain'],
    ['showStationMesh', 'Delaunay station surface'],
    ['showStations', 'Weather stations']
  ];
  for (const [key, labelText] of controls) {
    const label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:9px;margin:7px 0;cursor:pointer';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = settings[key];
    checkbox.style.accentColor = '#72d8b2';
    checkbox.addEventListener('change', () => {
      settings[key] = checkbox.checked;
      onChange();
    });
    label.append(checkbox, document.createTextNode(labelText));
    panel.append(label);
  }

  const status = document.createElement('p');
  status.dataset.windStatus = 'true';
  status.textContent = 'Loading original weather stations and 72-hour forecast…';
  status.style.cssText =
    'margin:13px 0 0;padding-top:11px;border-top:1px solid rgba(192,230,217,.16);' +
    'color:rgba(232,247,240,.65);font-size:12px';
  panel.append(status);
  return panel;
}

/** Mounts the original wind showcase using exclusively exported, reusable geo-layers. */
export function mountWindExample(
  container: HTMLElement,
  options: WindExampleOptions = {}
): () => void {
  const settings: WindSettings = {
    showParticles: true,
    showWind: true,
    showTerrain: true,
    showStationMesh: false,
    showStations: false
  };
  const abortController = new AbortController();
  let field: WindField | null = null;
  let terrainTexture: string | null = null;
  let animationFrame = 0;
  let lastFrameTime = 0;
  let animationTime = 0;
  let disposed = false;

  container.style.position = 'relative';
  container.style.background = '#0b1520';
  const panel = createSettingsPanel(settings, updateLayers);
  container.append(panel);
  const status = panel.querySelector<HTMLElement>('[data-wind-status]');

  const deck = new Deck({
    parent: container,
    width: '100%',
    height: '100%',
    views: new MapView({repeat: false}),
    initialViewState: INITIAL_VIEW_STATE,
    controller: {dragRotate: true, touchRotate: true, keyboard: true, inertia: 180},
    effects: [WIND_LIGHTING],
    parameters: {depthWriteEnabled: true},
    getTooltip: ({object}) => {
      const station = object as WindStation | undefined;
      return station?.name ? `${station.name}${station.state ? `, ${station.state}` : ''}` : null;
    },
    layers: []
  });
  options.onDeckInitialized?.(deck);

  function updateLayers(): void {
    if (!field || disposed) {
      return;
    }

    deck.setProps({
      layers: [
        settings.showTerrain &&
          new ElevationLayer({
            id: 'wind-height-map',
            elevationData: `${options.dataUrl ?? WIND_DATA_ROOT}/elevation.png`,
            bounds: ELEVATION_BOUNDS,
            elevationRange: [-100, 4126],
            elevationScale: ELEVATION_SCALE,
            meshMaxError: 480,
            color: [42, 60, 77, 255],
            texture: terrainTexture ?? undefined
          }),
        settings.showStationMesh &&
          new DelaunayCoverLayer({
            id: 'wind-station-terrain',
            windField: field,
            elevationScale: ELEVATION_SCALE,
            opacity: 0.32
          }),
        new GeoJsonLayer({
          id: 'wind-state-boundaries',
          data: US_STATE_BOUNDARIES,
          filled: false,
          stroked: true,
          getLineColor: [177, 188, 205, 95],
          getLineWidth: 1,
          lineWidthUnits: 'pixels',
          lineWidthMinPixels: 0.65,
          parameters: {depthCompare: 'always', depthWriteEnabled: false},
          pickable: false
        }),
        settings.showWind &&
          new WindLayer({
            id: 'wind-vectors',
            windField: field,
            time: animationTime,
            gridWidth: 40,
            gridHeight: 22,
            speedScale: 1.8,
            widthMinPixels: 1.1,
            lowColor: [52, 190, 160, 195],
            highColor: [239, 163, 137, 230],
            elevationScale: ELEVATION_SCALE,
            surfaceOffset: 3_200
          }),
        settings.showParticles &&
          new ParticleLayer({
            id: 'wind-particles',
            windField: field,
            time: animationTime,
            numParticles: 3_600,
            trailLength: 20,
            speedScale: 0.16,
            widthMinPixels: 1.1,
            pointRadiusPixels: 1,
            color: [237, 247, 255, 168],
            elevationScale: ELEVATION_SCALE,
            surfaceOffset: 4_600
          }),
        new TextLayer<WindCity>({
          id: 'wind-city-labels',
          data: WIND_CITIES,
          getPosition: city => {
            const sample = sampleWindField(field, city.position, animationTime);
            return [
              city.position[0],
              city.position[1],
              (sample?.elevation ?? 0) * ELEVATION_SCALE + 6_000
            ];
          },
          getText: city => city.name,
          getColor: [231, 232, 238, 215],
          getSize: 12,
          sizeUnits: 'pixels',
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          parameters: {depthWriteEnabled: false},
          pickable: false
        }),
        settings.showStations &&
          new ScatterplotLayer<WindStation>({
            id: 'wind-stations',
            data: field.stations,
            getPosition: station => [
              -station.long,
              station.lat,
              station.elv * ELEVATION_SCALE + 5_200
            ],
            getFillColor: [255, 227, 165, 205],
            getRadius: 3,
            radiusUnits: 'pixels',
            radiusMinPixels: 2,
            pickable: true
          })
      ]
    });
  }

  function animate(timestamp: number): void {
    if (disposed) {
      return;
    }
    if (timestamp - lastFrameTime >= 1000 / 30) {
      const elapsed = lastFrameTime ? Math.min(timestamp - lastFrameTime, 100) : 0;
      animationTime += elapsed / 1800;
      lastFrameTime = timestamp;
      if (status && field) {
        status.dataset.windFrame = animationTime.toFixed(3);
      }
      updateLayers();
    }
    animationFrame = window.requestAnimationFrame(animate);
  }

  const dataUrl = options.dataUrl ?? WIND_DATA_ROOT;
  void Promise.all([
    loadWindField(dataUrl, abortController.signal),
    loadTerrainTexture(dataUrl, abortController.signal)
  ])
    .then(([windField, nextTerrainTexture]) => {
      if (disposed) {
        return;
      }
      field = windField;
      terrainTexture = nextTerrainTexture;
      if (status) {
        status.textContent = `${windField.stations.length.toLocaleString()} stations · ${windField.frames.length} hourly weather frames`;
      }
      updateLayers();
      animationFrame = window.requestAnimationFrame(animate);
    })
    .catch((error: unknown) => {
      if (!disposed && status) {
        status.textContent = error instanceof Error ? error.message : 'Could not load wind data.';
      }
    });

  return () => {
    disposed = true;
    abortController.abort();
    window.cancelAnimationFrame(animationFrame);
    deck.finalize();
    panel.remove();
  };
}
