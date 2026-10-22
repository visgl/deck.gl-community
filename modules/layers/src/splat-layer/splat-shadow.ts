// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {Layer} from '@deck.gl/core';

/**
 * deck.gl offsets each layer's depth by its stack index in every pass to separate coplanar layers.
 * A shadow map stores fragment depth, so in deck.gl's shadow pass that offset pulls each later
 * layer toward the light, metres at map scale, and trees shadow themselves. Draw shadow depth
 * without it; the next layer sets its own offset again.
 */
export function clearShadowDepthOffset(layer: Layer): void {
  const device = layer.context.device as {setParametersWebGL?: (parameters: object) => void};
  device.setParametersWebGL?.({polygonOffset: [0, 0]});
}
