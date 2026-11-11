// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {TreeLayer} from '@deck.gl-community/layers';
import type {FieldFrame, FieldTree} from './field';

const getTree = (tree: FieldTree) => tree;

/** `TreeLayer` as it is, at `quality: 'photoreal'`. */
export function getFieldLayers(trees: FieldTree[], frame: FieldFrame) {
  return [
    new TreeLayer<FieldTree>({
      ...frame.layerProps,
      id: 'field-trees',
      quality: 'photoreal',
      data: trees,
      getTree,
      lodBias: frame.params.lodBias
    } as never)
  ];
}
