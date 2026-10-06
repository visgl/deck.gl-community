// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {AmbientLight, DirectionalLight, MapView, type MapViewState, type CompositeLayer} from '@deck.gl/core';
import {TreeLightingEffect} from './tree-lighting';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {PlaneGeometry} from '@luma.gl/engine';
import type {TreeType, Season, CropConfig} from '@deck.gl-community/layers';

// The historical Three.js fixture has a narrower species union. The lab supplies
// explicit props to each renderer; public TreeLayer itself retains its typed API.
export type TreeLayerConstructor = new (...props: any[]) => CompositeLayer<any>;

export const SPECIES: TreeType[] = ['pine', 'oak', 'palm', 'birch', 'cherry', 'banyan', 'mangrove'];
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
export type Specimen = {position: [number, number]; species: TreeType; index: number};
export type SceneOptions = {
  season: Season;
  crops: boolean;
  dropped: boolean;
  shadows: boolean;
  wind: boolean;
  backend: 'webgl' | 'webgpu';
  windTime: number | null;
  pixelRatio: number;
};
export const DEFAULT_OPTIONS: SceneOptions = {
  season: 'summer',
  crops: true,
  dropped: true,
  shadows: false,
  wind: false,
  backend: 'webgl',
  windTime: 0,
  pixelRatio: 1
};
export const VIEW: MapViewState = {
  longitude: 0,
  latitude: 0,
  zoom: 20.5,
  position: [0, 0, 5],
  pitch: 58,
  bearing: 22,
  minZoom: 16,
  maxZoom: 23,
  maxPitch: 80
};
const GROUND = new PlaneGeometry({type: 'x,y', xlen: 4000, ylen: 4000, nx: 1, ny: 1});

export function createSpecimens(species: TreeType, count = 1): Specimen[] {
  const width = Math.ceil(Math.sqrt(count));
  return Array.from({length: count}, (_, index) => ({
    index,
    species,
    position:
      count === 1
        ? [0, 0]
        : [
            (((index % width) - width / 2) * 18) / 111320,
            ((Math.floor(index / width) - width / 2) * 18) / 111320
          ]
  }));
}
export function getCrop(species: TreeType, options: SceneOptions): CropConfig | null {
  if ((!options.crops && !options.dropped) || species === 'mangrove') return null;
  // Mangrove propagules are not spherical fruit. Banyan figs are deliberately small.
  const color: [number, number, number, number] =
    species === 'cherry' && options.season === 'spring'
      ? [255, 208, 226, 255]
      : species === 'palm'
        ? [179, 102, 38, 255]
        : [214, 73, 39, 255];
  return {
    color,
    count: options.crops ? 32 : 0,
    droppedCount: options.dropped ? 12 : 0,
    radius: species === 'banyan' ? 0.06 : 0.16
  };
}
export function createSceneLayers(
  LayerClass: TreeLayerConstructor,
  id: string,
  data: Specimen[],
  options: SceneOptions
): [SimpleMeshLayer, CompositeLayer<any>] {
  return [
    new SimpleMeshLayer({
      id: `${id}-ground`,
      data: [{position: [0, 0, -0.02]}],
      mesh: GROUND,
      getColor: [226, 231, 222],
      material: {ambient: 1, diffuse: 0.15, shininess: 0},
      shadowEnabled: false
    }),
    new LayerClass({
      id: `${id}-trees`,
      data,
      getPosition: (d: Specimen) => d.position,
      getTreeType: (d: Specimen) => d.species,
      getHeight: () => 12,
      getTrunkHeightFraction: (d: Specimen) =>
        d.species === 'palm' ? 0.72 : d.species === 'pine' ? 0.18 : d.species === 'mangrove' ? 0.27 : 0.36,
      getTrunkRadius: (d: Specimen) => (d.species === 'palm' ? 0.25 : 0.38),
      getCanopyRadius: (d: Specimen) =>
        d.species === 'palm' ? 4.5 : d.species === 'birch' ? 5.5 : d.species === 'banyan' ? 10 : d.species === 'mangrove' ? 8 : 7,
      getBranchLevels: () => 4,
      getSeason: () => options.season,
      getCrop: (d: Specimen) => getCrop(d.species, options),
      windStrength: options.wind ? 0.025 : 0,
      windTime: options.windTime,
      shadowEnabled: true,
      pickable: true,
      updateTriggers: {
        getSeason: options.season,
        getCrop: [options.crops, options.dropped, options.season]
      }
    })
  ];
}
export function createLighting(shadows: boolean) {
  const effect = new TreeLightingEffect({
    ambient: new AmbientLight({color: [255, 255, 255], intensity: 1}),
    key: new DirectionalLight({
      color: [255, 246, 230],
      intensity: 1.5,
      direction: [-1, -0.6, -1.4],
      _shadow: shadows
    })
  });
  effect.shadowColor = [0.12, 0.18, 0.1, 0.28];
  return effect;
}
export function createViews() {
  return new MapView({id: 'specimen', controller: true});
}
