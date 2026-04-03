// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import tychoNegxUrl from './tycho-negx.jpg';
import tychoNegyUrl from './tycho-negy.jpg';
import tychoNegzUrl from './tycho-negz.jpg';
import tychoPosxUrl from './tycho-posx.jpg';
import tychoPosyUrl from './tycho-posy.jpg';
import tychoPoszUrl from './tycho-posz.jpg';

const PAPERMILL_BASE_URL =
  'https://raw.githubusercontent.com/uber-common/deck.gl-data/master/luma.gl/examples/gltf/papermill/specular';

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

export const TYCHO_CUBEMAP = {
  shape: 'image-texture-cube',
  faces: {
    '+X': tychoPosxUrl,
    '-X': tychoNegxUrl,
    '+Y': tychoPosyUrl,
    '-Y': tychoNegyUrl,
    '+Z': tychoPoszUrl,
    '-Z': tychoNegzUrl
  }
} as const;

export const PAPERMILL_CUBEMAP = {
  shape: 'image-texture-cube',
  faces: {
    '+X': `${PAPERMILL_BASE_URL}/specular_right_0.jpg`,
    '-X': `${PAPERMILL_BASE_URL}/specular_left_0.jpg`,
    '+Y': `${PAPERMILL_BASE_URL}/specular_top_0.jpg`,
    '-Y': `${PAPERMILL_BASE_URL}/specular_bottom_0.jpg`,
    '+Z': `${PAPERMILL_BASE_URL}/specular_front_0.jpg`,
    '-Z': `${PAPERMILL_BASE_URL}/specular_back_0.jpg`
  }
} as const;
