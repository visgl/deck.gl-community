// deck.gl-community
// SPDX-License-Identifier: MIT
import {AmbientLight, DirectionalLight} from '@deck.gl/core';
import type {Season} from '@deck.gl-community/layers';
import {TreeLightingEffect} from './tree-lighting';
import {DEFAULT_CASTER_HEIGHT} from './shadow-frustum';

export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
export type WorldOptions = {season: Season; wind: boolean; shadows: boolean};
/** Build the World example's bounded wood shadow lighting. */
export function createLighting(shadows: boolean, maxCasterHeight = DEFAULT_CASTER_HEIGHT) {
  const effect = new TreeLightingEffect({
    ambient: new AmbientLight({color: [255, 255, 255], intensity: 1}),
    key: new DirectionalLight({
      color: [255, 246, 230],
      intensity: 1.5,
      direction: [-1, -0.6, -1.4],
      _shadow: shadows
    })
  });
  effect.maxCasterHeight = maxCasterHeight;
  effect.shadowColor = [0.12, 0.18, 0.1, 0.28];
  return effect;
}
