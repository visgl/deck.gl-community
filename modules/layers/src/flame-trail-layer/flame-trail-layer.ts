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
import {getFlameInjectionsWGSL} from './flame-trail-layer.wgsl';

/** TripsLayer's API, rendered as automatically animated flames. */
export type FlameTrailLayerProps<DataT = unknown> = TripsLayerProps<DataT>;

const UNIFORM_DECLARATION = 'layout(std140) uniform flameTrailUniforms { float time; } flameTrail;';
const FLAME_UNIFORMS = {
  name: 'flameTrail',
  source: `struct FlameTrailUniforms { time: f32 };
    @group(0) @binding(auto) var<uniform> flameTrail: FlameTrailUniforms;`,
  vs: UNIFORM_DECLARATION,
  fs: UNIFORM_DECLARATION,
  uniformTypes: {time: 'f32'}
} as const satisfies ShaderModule<{time: number}>;

const defaultProps: DefaultProps<FlameTrailLayerProps> = {
  // White leaves every hue in the flame palette visible. Alpha still controls opacity.
  getColor: {type: 'accessor', value: [255, 255, 255, 255]},
  parameters: {depthWriteEnabled: false, cullMode: 'none'}
};

/**
 * A procedural 3D flame along timestamped paths, using the TripsLayer API.
 *
 * `currentTime` controls the visited path; turbulence and embers animate
 * automatically. `getColor` tints the palette; width controls flame height.
 * Uses crossed translucent slices and GPU embers in one instanced draw.
 * TerrainExtension supports ground fitting with `terrainDrawMode: 'offset'`
 * and `billboard: false`. WebGPU fitting requires deck.gl's terrain WGSL port
 * (visgl/deck.gl#10751); released SDKs can use elevated XYZ paths instead.
 * Depth writes are disabled by default on both backends.
 */
export class FlameTrailLayer<DataT = any, ExtraProps extends {} = {}> extends TripsLayer<
  DataT,
  ExtraProps
> {
  static layerName = 'FlameTrailLayer';
  static defaultProps = defaultProps;

  getShaders() {
    const shaders = super.getShaders();
    if (this.context.device.type === 'webgpu') {
      const inject = getFlameInjectionsWGSL(shaders.inject);
      let source = shaders.source;
      // Declare stage I/O before luma allocates extension varying locations.
      for (const anchor of [
        '  @location(12) rowIndexes: u32,',
        '  @location(5) vJointType: f32,'
      ]) {
        source = source.replace(anchor, `${anchor}\n${inject[anchor]}`);
        delete inject[anchor];
      }
      return {
        ...shaders,
        // Preserve both PathLayer antialiasing variants, then apply flame tint and picking.
        source: source.replace(
          /return deckgl_premultiplied_alpha\((color|varyings.vColor)\);/g,
          'return flameTrail_output($1, flameColor, varyings.flamePickingColor);'
        ),
        modules: [...shaders.modules, FLAME_UNIFORMS],
        defines: {
          ...shaders.defines,
          ...(shaders.modules.some(module => module.name === 'terrain') && {FLAME_TRAIL_TERRAIN: 1})
        },
        inject
      };
    }
    return {
      ...shaders,
      modules: [...shaders.modules, FLAME_UNIFORMS],
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
    const time = this.context.timeline.getTime() / 1000;
    this.state.model!.shaderInputs.setProps({flameTrail: {time}});
    super.draw(params);
    this.setNeedsRedraw();
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
