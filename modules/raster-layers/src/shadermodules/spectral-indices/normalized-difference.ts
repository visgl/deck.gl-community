// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Copyright 2022 Foursquare Labs, Inc.

import {ShaderModule} from '../types';

// Calculate standard normalized difference
const fs = /* glsl */ `\
float normalized_difference_calc(vec4 image) {
  return ((image.r - image.g) / (image.r + image.g));
}
`;

export const normalizedDifference: ShaderModule = {
  name: 'normalized_difference',
  fs,
  inject: {
    'fs:DECKGL_MUTATE_COLOR': `
    image = vec4(normalized_difference_calc(image), 0., 0., 0.);
    `
  }
};
