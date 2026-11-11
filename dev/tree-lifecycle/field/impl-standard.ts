// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {TreeLayer} from '@deck.gl-community/layers';
import type {FieldFrame, FieldTree} from './field';

const getTree = (tree: FieldTree) => tree;

/**
 * `TreeLayer` as it is, at `quality: 'standard'`. No wind direction, as `origin/master` has none, so that this
 * file measures the same thing on both.
 */
export function getFieldLayers(trees: FieldTree[], frame: FieldFrame) {
  const {windDirection: _windDirection, ...layerProps} = frame.layerProps;
  return [
    new TreeLayer<FieldTree>({
      ...layerProps,
      id: 'field-trees',
      quality: 'standard',
      data: trees,
      getTree
    } as never)
  ];
}
