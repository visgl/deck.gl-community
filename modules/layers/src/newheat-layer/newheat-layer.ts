// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {TripsLayer, type TripsLayerProps} from '@deck.gl/geo-layers';
import type {DefaultProps} from '@deck.gl/core';
import {Model} from '@luma.gl/engine';
import {FLAME_FUNCTIONS, FLAME_COLOR} from './newheat-layer-fragment';
import {FLAME_VERTEX, FLAME_VERTEX_DECLARATIONS} from './newheat-layer-vertex';
import {createFlameGeometry} from './newheat-geometry';

/** TripsLayer's API, with getColor tinting the procedural flame palette. */
export type NewHeatLayerProps<DataT = unknown> = TripsLayerProps<DataT>;

const defaultProps: DefaultProps<NewHeatLayerProps> = {
  // White leaves every hue in the flame palette visible. Alpha still controls opacity.
  getColor: {type: 'accessor', value: [255, 255, 255, 255]},
  parameters: {depthWriteEnabled: false, cullMode: 'none'}
};

/**
 * A rising, sliced flame volume along timestamped paths, using the TripsLayer API.
 *
 * Advance currentTime to animate both the trail and the flame. Keeping it fixed
 * freezes the result for reproducible frames. getColor multiplies the flame's
 * RGB palette; its alpha and the layer's opacity are preserved.
 * Path width also controls flame height. Uses 160 crossed volume slices in a
 * single draw with sparse drifting embers. Both use currentTime, including
 * ember lifetimes. Depth writes are disabled by default for translucent rendering.
 * TerrainExtension offset mode samples ground height for the volume and embers;
 * use billboard: false and a terrain source with operation: 'terrain+draw'.
 * Requires WebGL2, like the upstream TripsLayer shader.
 */
export class NewHeatLayer<DataT = any, ExtraProps extends {} = {}> extends TripsLayer<
  DataT,
  ExtraProps
> {
  static layerName = 'NewHeatLayer';
  static defaultProps = defaultProps;

  getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      defines: {
        ...shaders.defines,
        ...(shaders.modules.some(module => module.name === 'terrain') && {NEWHEAT_TERRAIN: 1})
      },
      inject: {
        ...shaders.inject,
        'vs:#decl': `${shaders.inject['vs:#decl']}\n${FLAME_VERTEX_DECLARATIONS}`,
        'vs:#main-end': `${shaders.inject['vs:#main-end']}\n${FLAME_VERTEX}`,
        'fs:#decl': `${shaders.inject['fs:#decl']}\n${FLAME_FUNCTIONS}`,
        'fs:#main-start': `
          // A zero-length fading trail is empty; avoid upstream division by zero.
          if (trips.fadeTrail && trips.trailLength <= 0.0) discard;
          ${shaders.inject['fs:#main-start']}
        `,
        'fs:DECKGL_FILTER_COLOR': `
          ${shaders.inject['fs:DECKGL_FILTER_COLOR']}
          ${FLAME_COLOR}
        `
      }
    };
  }

  protected _getModel(): Model {
    return new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
      geometry: createFlameGeometry(),
      isInstanced: true
    });
  }
}
