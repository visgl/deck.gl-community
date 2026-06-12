// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Geometry} from '@luma.gl/engine';

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

function getArrowAttributes({length = 1, headSize = 0.2, tailWidth = 0.05, tailStart = 0.05}) {
  const texCoords = [
    // HEAD
    0.5,
    1.0,
    0.5 - headSize / 2,
    1.0 - headSize,
    0.5 + headSize / 2,
    1.0 - headSize,
    0.5 - tailWidth / 2,
    tailStart,
    0.5 + tailWidth / 2,
    1.0 - headSize,
    0.5 + tailWidth / 2,
    tailStart,
    0.5 - tailWidth / 2,
    tailStart,
    0.5 - tailWidth / 2,
    1.0 - headSize,
    0.5 + tailWidth / 2,
    1.0 - headSize
  ];

  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];

  // Center and scale
  const positions = new Array((texCoords.length / 2) * 3);
  for (let i = 0; i < texCoords.length / 2; i++) {
    const i2 = i * 2;
    const i3 = i * 3;
    positions[i3 + 0] = (texCoords[i2 + 0] - 0.5) * length;
    positions[i3 + 1] = (texCoords[i2 + 1] - 0.5) * length;
    positions[i3 + 2] = 0;
  }
  return {
    positions: {size: 3, value: new Float32Array(positions)},
    normals: {size: 3, value: new Float32Array(normals)},
    texCoords: {size: 2, value: new Float32Array(texCoords)}
  };
}
