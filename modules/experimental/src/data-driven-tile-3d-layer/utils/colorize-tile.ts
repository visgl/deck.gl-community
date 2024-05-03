// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {customizeColors} from '@loaders.gl/i3s';
import {Tile3D} from '@loaders.gl/tiles';
import {ColorsByAttribute} from '../data-driven-tile-3d-layer';

/**
 * Update tile colors with the custom colors assigned to the I3S Loader
 * @returns {Promise<{isColored: boolean; id: string}>} Result of the tile colorization - isColored: true/false and tile id
 */
export const colorizeTile = async (
  tile: Tile3D,
  colorsByAttribute: ColorsByAttribute | null
): Promise<{isColored: boolean; id: string}> => {
  const result = {isColored: false, id: tile.id};

  if (tile.content.customColors !== colorsByAttribute) {
    if (tile.content && colorsByAttribute) {
      if (!tile.content.originalColorsAttributes) {
        tile.content.originalColorsAttributes = {
          ...tile.content.attributes.colors,
          value: new Uint8Array(tile.content.attributes.colors.value)
        };
      } else if (colorsByAttribute.mode === 'multiply') {
        tile.content.attributes.colors.value.set(tile.content.originalColorsAttributes.value);
      }

      tile.content.customColors = colorsByAttribute;

      const newColors = await customizeColors(
        tile.content.attributes.colors,
        tile.content.featureIds,
        tile.header.attributeUrls,
        tile.tileset.tileset.fields,
        tile.tileset.tileset.attributeStorageInfo,
        colorsByAttribute,
        (tile.tileset.loadOptions as any).i3s.token
      );
      // Make sure custom colors is not changed during async customizeColors execution
      if (tile.content.customColors === colorsByAttribute) {
        tile.content.attributes.colors = newColors;
        result.isColored = true;
      }
    } else if (tile.content && tile.content.originalColorsAttributes) {
      tile.content.attributes.colors.value = tile.content.originalColorsAttributes.value;
      tile.content.customColors = null;
      result.isColored = true;
    }
  }
  return result;
};
