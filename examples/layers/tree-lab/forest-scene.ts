// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {TreeLayer} from '@deck.gl-community/layers';
import {createSceneLayers, type SceneOptions, type TreeLayerConstructor} from './scene';
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
