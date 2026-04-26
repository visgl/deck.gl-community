// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {loadModule} from '@deck.gl-community/bing-maps';
import {type PickingInfo} from '@deck.gl/core';
import {GeoJsonLayer, ArcLayer} from '@deck.gl/layers';
import type {Feature, FeatureCollection, Point} from 'geojson';

// set your Bing Maps API key here
let BING_MAPS_API_KEY = 'NO-KEY-SUPPLIED';

const processEnv = (
  globalThis as typeof globalThis & {process?: {env?: {VITE_BING_MAPS_API_KEY?: string}}}
).process?.env;

if (processEnv?.VITE_BING_MAPS_API_KEY) {
  BING_MAPS_API_KEY = processEnv.VITE_BING_MAPS_API_KEY;
} else if (typeof import.meta !== 'undefined') {
  const metaEnv = (import.meta as {env?: {VITE_BING_MAPS_API_KEY?: string}}).env;
  if (metaEnv?.VITE_BING_MAPS_API_KEY) {
    BING_MAPS_API_KEY = metaEnv.VITE_BING_MAPS_API_KEY;
  }
}

// source: Natural Earth http://www.naturalearthdata.com/ via geojson.xyz
const AIR_PORTS =
  'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_10m_airports.geojson';

type NaturalEarthAirportProperties = {
  abbrev: string;
  name: string;
  scalerank: number;
};

type NaturalEarthAirportFeature = Feature<Point, NaturalEarthAirportProperties>;

type NaturalEarthAirportCollection = FeatureCollection<Point, NaturalEarthAirportProperties>;

type BingMapsModule = {
  Map: new (
    container: HTMLElement,
    options: {
      credentials: string;
      supportedMapTypes: string[];
      disableBirdsEye: boolean;
      disableStreetside: boolean;
    }
  ) => {
    setView(view: {center: unknown; zoom: number}): void;
    layers: {
      insert(layer: {finalize?: () => void}): void;
      remove?(layer: {finalize?: () => void}): void;
    };
    dispose?(): void;
  };
  MapTypeId: {
    aerial: string;
    canvasLight: string;
    canvasDark: string;
  };
  Location: new (latitude: number, longitude: number) => unknown;
  DeckOverlay: new (props: {
    layers: [GeoJsonLayer<NaturalEarthAirportProperties>, ArcLayer<NaturalEarthAirportFeature>];
    getTooltip: (info: PickingInfo<NaturalEarthAirportFeature>) => string | null;
  }) => {
    finalize?(): void;
  };
};

export function exampleApplication(): Promise<(() => void) | undefined> {
  const container = document.getElementById('map');
  if (!(container instanceof HTMLElement)) {
    throw new Error('Unable to find #map container');
  }

  return mountBingMapsGetStartedExample(container);
}

export async function mountBingMapsGetStartedExample(container: HTMLElement): Promise<() => void> {
  const {Map, MapTypeId, Location, DeckOverlay} = (await loadModule()) as BingMapsModule;

  container.replaceChildren();

  const map = new Map(container, {
    credentials: BING_MAPS_API_KEY,
    supportedMapTypes: [MapTypeId.aerial, MapTypeId.canvasLight, MapTypeId.canvasDark],
    disableBirdsEye: true,
    disableStreetside: true
  });

  map.setView({
    center: new Location(51.47, 0.45),
    zoom: 4
  });

  const deckOverlay = new DeckOverlay({
    layers: [
      new GeoJsonLayer<NaturalEarthAirportProperties>({
        id: 'airports',
        data: AIR_PORTS,
        filled: true,
        pointRadiusMinPixels: 2,
        pointRadiusScale: 2000,
        getPointRadius: feature => 11 - (feature.properties?.scalerank ?? 0),
        getFillColor: [200, 0, 80, 180],
        pickable: true,
        autoHighlight: true,
        onClick: info => {
          const airport = info.object as NaturalEarthAirportFeature | null;
          if (!airport) {
            return;
          }
          // eslint-disable-next-line no-alert
          alert(`${airport.properties.name} (${airport.properties.abbrev})`);
        }
      }),
      new ArcLayer<NaturalEarthAirportFeature>({
        id: 'arcs',
        data: AIR_PORTS,
        dataTransform: getPrimaryAirportFeatures as unknown as <LayerDataT = unknown>(
          data: unknown,
          previousData?: LayerDataT
        ) => LayerDataT,
        getSourcePosition: () => [-0.4531566, 51.4709959],
        getTargetPosition: feature => feature.geometry.coordinates as [number, number],
        getSourceColor: [0, 128, 200],
        getTargetColor: [200, 0, 80],
        getWidth: 1
      })
    ],
    getTooltip: (info: PickingInfo<NaturalEarthAirportFeature>) =>
      info.object?.properties.name ?? null
  });

  map.layers.insert(deckOverlay);

  return () => {
    map.layers.remove?.(deckOverlay);
    deckOverlay.finalize?.();
    map.dispose?.();
    container.replaceChildren();
  };
}

function getPrimaryAirportFeatures(
  data: NaturalEarthAirportCollection
): NaturalEarthAirportFeature[] {
  return data.features.filter(feature => (feature.properties?.scalerank ?? 0) < 4);
}
