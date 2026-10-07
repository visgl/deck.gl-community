// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {WebMercatorViewport, type MapViewState} from '@deck.gl/core';
import type {TreeLayer} from '@deck.gl-community/layers';
import {VIEW, createSceneLayers, type SceneOptions, type TreeLayerConstructor} from './scene';
import type {ForestSpecimen} from './forest-data';

const getHeight = (tree: ForestSpecimen) => tree.height;
const getCanopyRadius = (tree: ForestSpecimen) => tree.canopyRadius;
const getTrunkRadius = (tree: ForestSpecimen) => tree.trunkRadius;

/** Both benchmarks and the live forest use the same dimensions and deterministic source rows. */
export function createForestSceneLayers(
  LayerClass: TreeLayerConstructor,
  id: string,
  data: ForestSpecimen[],
  options: SceneOptions
) {
  const layers = createSceneLayers(LayerClass, id, data, options);
  layers[1] = (layers[1] as TreeLayer<ForestSpecimen>).clone({
    getHeight,
    getCanopyRadius,
    getTrunkRadius
  });
  return layers;
}

/** Shared forest cameras keep the live example and its benchmark at the same scale. */
export function getForestViewState(
  count: number,
  width: number,
  height: number,
  overview = false
): MapViewState {
  const camera: MapViewState = {
    ...VIEW,
    minZoom: 10,
    zoom: 17.2,
    pitch: 60,
    position: [0, 0, 7]
  };
  if (!overview) return camera;
  const halfSide = (Math.ceil(Math.sqrt(count)) * 9 + 20) / 111320;
  const fitted = new WebMercatorViewport({width, height}).fitBounds(
    [
      [-halfSide, -halfSide],
      [halfSide, halfSide]
    ],
    {padding: 40}
  );
  return {
    ...camera,
    longitude: fitted.longitude,
    latitude: fitted.latitude,
    position: [0, 0, 0],
    bearing: 0,
    pitch: 35,
    zoom: fitted.zoom - 0.1
  };
}
