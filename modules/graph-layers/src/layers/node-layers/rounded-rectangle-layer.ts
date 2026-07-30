// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {PathBasedRoundedRectangleLayer} from './path-rounded-rectangle-layer';

/**
 * Renders rounded graph nodes with deck.gl's dual-backend PolygonLayer.
 *
 * @remarks
 * Rounded corners are tessellated on the CPU, so the same polygon and path shaders are used on
 * WebGL2 and WebGPU.
 */
export class RoundedRectangleLayer extends PathBasedRoundedRectangleLayer {
  static layerName = 'RoundedRectangleLayer';
}
