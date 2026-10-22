// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Ported from visgl/deck.gl PR #10492 (MIT, vis.gl contributors).
export type Landmark = {
  id: string;
  cityId: string;
  name: string;
  position: [number, number];
};

export type CityPanel = {
  id: string;
  title: string;
  subtitle: string;
  mapStyle: string;
  viewState: {
    longitude: number;
    latitude: number;
    zoom: number;
    pitch: number;
    bearing: number;
  };
  landmarks: Landmark[];
};

export const CITY_PANELS: CityPanel[] = [
  {
    id: 'new-york',
    title: 'New York',
    subtitle: 'Midtown lights and waterfront routes',
    mapStyle: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    viewState: {longitude: -73.9857, latitude: 40.7484, zoom: 10.8, pitch: 35, bearing: -12},
    landmarks: [
      {id: 'times-square', cityId: 'new-york', name: 'Times Square', position: [-73.9851, 40.758]},
      {id: 'central-park', cityId: 'new-york', name: 'Central Park', position: [-73.9712, 40.7831]},
      {
        id: 'brooklyn-bridge',
        cityId: 'new-york',
        name: 'Brooklyn Bridge',
        position: [-73.9969, 40.7061]
      }
    ]
  },
  {
    id: 'london',
    title: 'London',
    subtitle: 'River crossings and west end clusters',
    mapStyle: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    viewState: {longitude: -0.1276, latitude: 51.5072, zoom: 10.8, pitch: 40, bearing: 18},
    landmarks: [
      {id: 'soho', cityId: 'london', name: 'Soho', position: [-0.1337, 51.5138]},
      {id: 'tower-bridge', cityId: 'london', name: 'Tower Bridge', position: [-0.0754, 51.5055]},
      {id: 'greenwich', cityId: 'london', name: 'Greenwich', position: [0.0005, 51.4826]}
    ]
  },
  {
    id: 'tokyo',
    title: 'Tokyo',
    subtitle: 'Station density across the eastern core',
    mapStyle: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
    viewState: {longitude: 139.7588, latitude: 35.6762, zoom: 10.7, pitch: 45, bearing: -22},
    landmarks: [
      {id: 'shibuya', cityId: 'tokyo', name: 'Shibuya', position: [139.7016, 35.6595]},
      {id: 'tokyo-station', cityId: 'tokyo', name: 'Tokyo Station', position: [139.7671, 35.6812]},
      {id: 'asakusa', cityId: 'tokyo', name: 'Asakusa', position: [139.7967, 35.7148]}
    ]
  },
  {
    id: 'sydney',
    title: 'Sydney',
    subtitle: 'Harbor landmarks with coastal spillover',
    mapStyle: 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json',
    viewState: {longitude: 151.2093, latitude: -33.8688, zoom: 10.9, pitch: 42, bearing: 24},
    landmarks: [
      {id: 'opera-house', cityId: 'sydney', name: 'Opera House', position: [151.2153, -33.8568]},
      {id: 'bondi', cityId: 'sydney', name: 'Bondi Beach', position: [151.2743, -33.8915]},
      {id: 'newtown', cityId: 'sydney', name: 'Newtown', position: [151.179, -33.8981]}
    ]
  }
];
