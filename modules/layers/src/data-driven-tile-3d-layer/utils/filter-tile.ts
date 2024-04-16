// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Tile3D} from '@loaders.gl/tiles';
import {FiltersByAttribute} from '../data-driven-tile-3d-layer';
import {AttributeStorageInfo, I3SAttributeLoader} from '@loaders.gl/i3s';
import {load} from '@loaders.gl/core';
import {TypedArray} from '@loaders.gl/schema';

type I3STileAttributes = Record<string, string[] | TypedArray | null>;

/**
 * Filter tile indices by attribute value
 * @param tile - tile to be filtered
 * @param filtersByAttribute - custom filters patameters
 * @returns {Promise<{isFiltered: boolean; id: string}>} Result of the tile filtering - isFiltered: true/false and tile id
 */
export const filterTile = async (
  tile: Tile3D,
  filtersByAttribute: FiltersByAttribute | null
): Promise<{isFiltered: boolean; id: string}> => {
  const result = {isFiltered: false, id: tile.id};

  if (tile.content.userData?.customFilters !== filtersByAttribute) {
    if (tile.content && filtersByAttribute) {
      if (tile.content.userData?.originalIndices === undefined) {
        tile.content.userData = {};
        // save original indices for filtring cancellation
        tile.content.userData.originalIndices = tile.content.indices;
      }
      tile.content.indices = tile.content.userData?.originalIndices;
      tile.content.userData.customFilters = filtersByAttribute;

      const {indices} = await filterTileIndices(
        tile,
        filtersByAttribute,
        (tile.tileset.loadOptions as any).i3s.token
      );
      // Make sure custom filters is not changed during async filtring execution
      if (indices && tile.content.userData.customFilters === filtersByAttribute) {
        tile.content.indices = indices;
        result.isFiltered = true;
      }
    } else if (tile.content && tile.content.userData?.originalIndices !== undefined) {
      tile.content.indices = tile.content.userData.originalIndices;
      tile.content.userData.customFilters = null;
      result.isFiltered = true;
    }
  }
  return result;
};

// eslint-disable-next-line max-statements, complexity
async function filterTileIndices(
  tile: Tile3D,
  filtersByAttribute: FiltersByAttribute,
  token: string
): Promise<{success: boolean; indices?: Uint32Array}> {
  if (!filtersByAttribute.attributeName.length) {
    return {success: false};
  }

  const filterAttributeField = tile.tileset.tileset.fields.find(
    ({name}) => name === filtersByAttribute?.attributeName
  );

  if (
    !filterAttributeField ||
    !['esriFieldTypeDouble', 'esriFieldTypeInteger', 'esriFieldTypeSmallInteger'].includes(
      filterAttributeField.type
    )
  ) {
    return {success: false};
  }

  const tileFilterAttributeData = await loadFeatureAttributeData(
    filterAttributeField.name,
    tile.header.attributeUrls,
    tile.tileset.tileset.attributeStorageInfo,
    token
  );
  if (!tileFilterAttributeData) {
    return {success: false};
  }

  const objectIdField = tile.tileset.tileset.fields.find(({type}) => type === 'esriFieldTypeOID');
  if (!objectIdField) {
    return {success: false};
  }

  const objectIdAttributeData = await loadFeatureAttributeData(
    objectIdField.name,
    tile.header.attributeUrls,
    tile.tileset.tileset.attributeStorageInfo,
    token
  );
  if (!objectIdAttributeData) {
    return {success: false};
  }

  const attributeValuesMap = {};
  objectIdAttributeData[objectIdField.name]?.forEach((elem, index) => {
    attributeValuesMap[elem] =
      tileFilterAttributeData[filterAttributeField.name][index];
  });

  if (!tile.content.indices) {
    const triangles: number[] = [];
    for (let i = 0; i < tile.content.featureIds.length; i += 3) {
      if (attributeValuesMap[tile.content.featureIds[i]] === filtersByAttribute.value) {
        triangles.push(i);
      }
    }

    const indices = new Uint32Array(3 * triangles.length);

    triangles.forEach((vertex, index) => {
      indices[index * 3] = vertex;
      indices[index * 3 + 1] = vertex + 1;
      indices[index * 3 + 2] = vertex + 2;
    });
    return {success: true, indices};
  }
  const triangles: number[] = [];
  for (let i = 0; i < tile.content.indices.length; i += 3) {
    if (
      attributeValuesMap[tile.content.featureIds[tile.content.indices[i]]] ===
        filtersByAttribute.value
    ) {
      triangles.push(i);
    }
  }

  const indices = new Uint32Array(3 * triangles.length);

  triangles.forEach((vertex, index) => {
    indices[index * 3] = tile.content.indices[vertex];
    indices[index * 3 + 1] = tile.content.indices[vertex + 1];
    indices[index * 3 + 2] = tile.content.indices[vertex + 2];
  });
  return {success: true, indices};

}

async function loadFeatureAttributeData(
  attributeName: string,
  attributeUrls: string[],
  attributesStorageInfo: AttributeStorageInfo[],
  token?: string
): Promise<I3STileAttributes | null> {
  const attributeIndex = attributesStorageInfo.findIndex(({name}) => attributeName === name);
  if (attributeIndex === -1) {
    return null;
  }
  const objectIdAttributeUrl = getUrlWithToken(attributeUrls[attributeIndex], token);
  const attributeType = getAttributeValueType(attributesStorageInfo[attributeIndex]);
  const objectIdAttributeData = await load(objectIdAttributeUrl, I3SAttributeLoader, {
    attributeName,
    attributeType
  });

  return objectIdAttributeData;
}

function getUrlWithToken(url: string, token: string | null = null): string {
  return token ? `${url}?token=${token}` : url;
}

function getAttributeValueType(attribute: AttributeStorageInfo) {
  // eslint-disable-next-line no-prototype-builtins
  if (attribute.hasOwnProperty('objectIds')) {
    return 'Oid32';
    // eslint-disable-next-line no-prototype-builtins
  } else if (attribute.hasOwnProperty('attributeValues')) {
    return attribute.attributeValues?.valueType;
  }
  return '';
}
