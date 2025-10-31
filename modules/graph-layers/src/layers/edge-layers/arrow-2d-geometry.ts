// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Geometry} from '@luma.gl/engine';

// Mirror of the arrow geometry used by PathMarkerLayer, but only the head triangle.
export class Arrow2DGeometry extends Geometry {
  constructor(opts = {}) {
    super(
      Object.assign({}, opts, {
        attributes: getArrowAttributes(opts),
        topology: 'triangle-list' as const
      })
    );
  }
}

function getArrowAttributes({length = 1, headWidth = 1}) {
  const halfLength = length / 2;
  const halfWidth = headWidth / 2;

  const positions = new Float32Array([
    0,
    halfLength,
    0,
    -halfWidth,
    -halfLength,
    0,
    halfWidth,
    -halfLength,
    0
  ]);

  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);

  const texCoords = new Float32Array([
    0.5,
    1,
    0,
    0,
    1,
    0
  ]);

  return {
    positions: {size: 3, value: positions},
    normals: {size: 3, value: normals},
    texCoords: {size: 2, value: texCoords}
  };
}
