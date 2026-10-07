// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {TreeTileLayer} from './tree-tile-layer';
import {TreeLayer} from './tree-layer';
export type {
  TreeTileLayerProps as WorldTreeLayerProps,
  TreeTileData,
  TreeCanopyCluster,
  TreeTileStats
} from './tree-tile-layer';

/** @deprecated Use TreeLayer with getTileData and ordinary top-level tree accessors. */
export class WorldTreeLayer<DataT = unknown> extends TreeTileLayer<DataT> {
  static layerName = 'WorldTreeLayer';
  static defaultProps = {...TreeTileLayer.defaultProps, _TreeLayerClass: TreeLayer};
}
