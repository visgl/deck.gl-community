// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {Layer} from '@deck.gl/core';

/**
 * Prepares a draw in deck.gl's shadow pass and returns whether to draw at all. deck.gl 9.4's
 * shadow module has no WGSL, so no WebGPU shader reads the map. deck.gl also offsets each layer's
 * depth by its stack index, in the shadow pass too, which pulls later layers' shadow depth toward
 * the light (metres at map scale) so they shadow themselves; draw shadow depth without it. The
 * next layer sets its own offset again.
 */
export function prepareShadowDraw(layer: Layer): boolean {
  if (layer.context.device.type === 'webgpu') return false;
  const device = layer.context.device as {setParametersWebGL?: (parameters: object) => void};
  device.setParametersWebGL?.({polygonOffset: [0, 0]});
  return true;
}
