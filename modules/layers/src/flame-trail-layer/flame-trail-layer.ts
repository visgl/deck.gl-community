// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {TripsLayer, type TripsLayerProps} from '@deck.gl/geo-layers';
import type {DefaultProps} from '@deck.gl/core';
import {Model} from '@luma.gl/engine';
import type {ShaderModule} from '@luma.gl/shadertools';
import {FLAME_FUNCTIONS, FLAME_COLOR} from './flame-trail-layer-fragment';
import {FLAME_VERTEX, FLAME_VERTEX_DECLARATIONS} from './flame-trail-layer-vertex';
import {createFlameGeometry} from './flame-trail-geometry';

/** TripsLayer's API, with an independent flame clock and palette tinting. */
export type FlameTrailLayerProps<DataT = unknown> = TripsLayerProps<DataT> & {
  /** Animation time in seconds. Omit to animate with deck.gl's timeline;
   * hold a number fixed to freeze turbulence and embers independently of the trip. */
  flameTime?: number;
};

const CLOCK_DECLARATION = 'layout(std140) uniform flameTrailUniforms { float time; } flameTrail;';
const FLAME_CLOCK = {
  name: 'flameTrail',
  vs: CLOCK_DECLARATION,
  fs: CLOCK_DECLARATION,
  uniformTypes: {time: 'f32'}
} as const satisfies ShaderModule<{time: number}>;

const defaultProps: DefaultProps<FlameTrailLayerProps> = {
  flameTime: {
    type: 'number',
    value: undefined,
    validate: value => value === undefined || Number.isFinite(value)
  },
  // White leaves every hue in the flame palette visible. Alpha still controls opacity.
  getColor: {type: 'accessor', value: [255, 255, 255, 255]},
  parameters: {depthWriteEnabled: false, cullMode: 'none'}
};

/**
 * A procedural 3D flame along timestamped paths, using the TripsLayer API.
 *
 * `currentTime` controls the visited path; `flameTime` animates turbulence and
 * embers independently. `getColor` tints the palette; width controls flame height.
 * Uses crossed translucent slices and GPU embers in one instanced draw.
 * TerrainExtension supports ground fitting with `terrainDrawMode: 'offset'`
 * and `billboard: false`. Requires WebGL2; depth writes are disabled by default.
 */
export class FlameTrailLayer<DataT = any, ExtraProps extends {} = {}> extends TripsLayer<
  DataT,
  ExtraProps & FlameTrailLayerProps<DataT>
> {
  static layerName = 'FlameTrailLayer';
  static defaultProps = defaultProps;

  getShaders() {
    if (this.context.device.type !== 'webgl') {
      throw new Error('FlameTrailLayer requires a WebGL2 device.');
    }
    const shaders = super.getShaders();
    return {
      ...shaders,
      modules: [...shaders.modules, FLAME_CLOCK],
      defines: {
        ...shaders.defines,
        ...(shaders.modules.some(module => module.name === 'terrain') && {FLAME_TRAIL_TERRAIN: 1})
      },
      inject: {
        ...shaders.inject,
        'vs:#decl': `${shaders.inject['vs:#decl']}\n${FLAME_VERTEX_DECLARATIONS}`,
        'vs:#main-end': `${shaders.inject['vs:#main-end']}\n${FLAME_VERTEX}`,
        'fs:#decl': `${shaders.inject['fs:#decl']}\n${FLAME_FUNCTIONS}`,
        'fs:DECKGL_FILTER_COLOR': `
          // Evaluate PathLayer's coverage derivatives before discarding fragments.
          // A zero-length fading trail is empty; avoid upstream division by zero.
          if (trips.fadeTrail && trips.trailLength <= 0.0) discard;
          ${shaders.inject['fs:DECKGL_FILTER_COLOR']}
          ${FLAME_COLOR}
        `
      }
    };
  }

  override draw(params): void {
    const time = this.props.flameTime ?? (this.context.timeline?.getTime() ?? 0) / 1000;
    this.state.model!.shaderInputs.setProps({flameTrail: {time}});
    super.draw(params);
    if (this.props.flameTime === undefined) this.setNeedsRedraw();
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
