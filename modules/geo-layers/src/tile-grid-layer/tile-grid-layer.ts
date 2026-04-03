// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type Color, type DefaultProps} from '@deck.gl/core';
import {PathLayer, TextLayer} from '@deck.gl/layers';

import type {SharedTile2DHeader} from '../tileset/index';
import type {TileBoundingBox} from '../tileset/types';

/** Label content or formatter used by {@link TileGridLayer}. */
type TileGridLabelAccessor = string | ((tile: SharedTile2DHeader<unknown>) => string);

/**
 * Props for {@link TileGridLayer}, a helper overlay for visualizing tile loading
 * and tile selection in tiled layers.
 */
export type TileGridLayerProps = {
  /** Tile header whose bounds and index should be visualized. */
  tile: SharedTile2DHeader<unknown>;
  /** Whether to draw an outline around the tile bounds. Defaults to `true`. */
  showBorder?: boolean;
  /** Whether to render a label at the tile center. Defaults to `true`. */
  showLabel?: boolean;
  /** Static label text or formatter for per-tile label content. */
  getLabel?: TileGridLabelAccessor;
  /** Stroke color used for the tile border. */
  borderColor?: Color;
  /** Text color used for the tile label. */
  labelColor?: Color;
  /** Background color used behind the tile label text. */
  labelBackgroundColor?: Color;
  /** Minimum screen-space width of the tile border in pixels. */
  borderWidthMinPixels?: number;
  /** Screen-space font size of the tile label in pixels. */
  labelSize?: number;
};

/** Internal derived geometry used to render one tile grid overlay. */
type TileGridLayerItem = {
  path: [number, number][];
  center: [number, number];
  label: string;
};

/** Default prop values for {@link TileGridLayer}. */
const defaultProps: DefaultProps<TileGridLayerProps> = {
  tile: {type: 'object', value: undefined!},
  showBorder: true,
  showLabel: true,
  getLabel: {
    type: 'function',
    value: (tile: SharedTile2DHeader<unknown>) =>
      `z${tile.index.z} x${tile.index.x} y${tile.index.y}`
  },
  borderColor: [255, 255, 255, 180],
  labelColor: [255, 255, 255, 255],
  labelBackgroundColor: [15, 23, 42, 210],
  borderWidthMinPixels: 1,
  labelSize: 12
};

/** Converts a tile bounding box into a closed outline path. */
function getTilePath(bbox: TileBoundingBox): [number, number][] {
  if ('west' in bbox) {
    return [
      [bbox.west, bbox.north],
      [bbox.west, bbox.south],
      [bbox.east, bbox.south],
      [bbox.east, bbox.north],
      [bbox.west, bbox.north]
    ];
  }

  return [
    [bbox.left, bbox.top],
    [bbox.left, bbox.bottom],
    [bbox.right, bbox.bottom],
    [bbox.right, bbox.top],
    [bbox.left, bbox.top]
  ];
}

/** Returns the center point of a tile bounding box. */
function getTileCenter(bbox: TileBoundingBox): [number, number] {
  if ('west' in bbox) {
    return [(bbox.west + bbox.east) / 2, (bbox.north + bbox.south) / 2];
  }

  return [(bbox.left + bbox.right) / 2, (bbox.top + bbox.bottom) / 2];
}

/**
 * Helper layer that renders a tile outline and optional label for visualizing tile
 * loading, coverage, and traversal.
 */
export class TileGridLayer extends CompositeLayer<TileGridLayerProps> {
  static layerName = 'TileGridLayer';
  static defaultProps: DefaultProps<TileGridLayerProps> = defaultProps;

  /** Builds the tile border and label sublayers. */
  renderLayers() {
    const {
      tile,
      showBorder,
      showLabel,
      getLabel,
      borderColor,
      labelColor,
      labelBackgroundColor,
      borderWidthMinPixels,
      labelSize
    } = this.props;

    const item: TileGridLayerItem = {
      path: getTilePath(tile.bbox),
      center: getTileCenter(tile.bbox),
      label: typeof getLabel === 'function' ? getLabel(tile) : getLabel
    };

    return [
      showBorder
        ? new PathLayer<TileGridLayerItem>(
            this.getSubLayerProps({
              id: 'border'
            }),
            {
              data: [item],
              getPath: (d) => d.path,
              getColor: borderColor,
              widthMinPixels: borderWidthMinPixels,
              pickable: false
            }
          )
        : null,
      showLabel
        ? new TextLayer<TileGridLayerItem>(
            this.getSubLayerProps({
              id: 'label'
            }),
            {
              data: [item],
              getPosition: (d) => d.center,
              getText: (d) => d.label,
              getColor: labelColor,
              getBackgroundColor: labelBackgroundColor,
              getSize: labelSize,
              sizeUnits: 'pixels',
              background: true,
              getTextAnchor: 'middle',
              getAlignmentBaseline: 'center',
              pickable: false
            }
          )
        : null
    ];
  }
}
