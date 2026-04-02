// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export const SKYBOX_CUBEMAP = {
  shape: 'image-texture-cube',
  faces: {
    '+X': 'https://raw.githubusercontent.com/visgl/luma.gl/master/examples/api/cubemap/sky-posx.png',
    '-X': 'https://raw.githubusercontent.com/visgl/luma.gl/master/examples/api/cubemap/sky-negx.png',
    '+Y': 'https://raw.githubusercontent.com/visgl/luma.gl/master/examples/api/cubemap/sky-posy.png',
    '-Y': 'https://raw.githubusercontent.com/visgl/luma.gl/master/examples/api/cubemap/sky-negy.png',
    '+Z': 'https://raw.githubusercontent.com/visgl/luma.gl/master/examples/api/cubemap/sky-posz.png',
    '-Z': 'https://raw.githubusercontent.com/visgl/luma.gl/master/examples/api/cubemap/sky-negz.png'
  }
} as const;
