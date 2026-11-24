// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {TripsLayer, type TripsLayerProps} from '@deck.gl/geo-layers';
import type {DefaultProps} from '@deck.gl/core';
import {Model} from '@luma.gl/engine';
import type {ShaderModule} from '@luma.gl/shaders';
import {FLAME_FUNCTIONS, FLAME_COLOR} from './flame-trail-layer-fragment';
import {FLAME_VERTEX, FLAME_VERTEX_DECLARATIONS} from './flame-trail-layer-vertex';
import {createFlameGeometry} from './flame-trail-geometry';
import {getFlameInjectionsWGSL} from './flame-trail-layer.wgsl.js';

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
    const tripsPlugin = shaders.plugins.find(plugin => plugin.name === 'trips');
    if (this.context.device.type === 'webgpu') {
      const inject = getFlameInjectionsWGSL();
      let source = shaders.source;
      for (const [anchor, code] of Object.entries(inject)) {
        if (!anchor.includes('#')) {
          source = source.replace(anchor, `${anchor}\n${code}`);
        }
      }
      source = source
        .replace(
          '  DECKGL_FILTER_PATH_COLOR_VERTEX(&varyings.vColor, varyings.vPathPosition, varyings.vPathLength);',
          ''
        )
        .replace(
          'fn fragmentMain(varyings: Varyings) -> @location(0) vec4<f32> {',
          `fn fragmentMain(varyings: Varyings) -> @location(0) vec4<f32> {\n${inject['fs:#main-start']}`
        )
        .replace(
          '  DECKGL_FILTER_PATH_COLOR();',
          `
          if (varyings.vTime > trips.currentTime ||
              (trips.fadeTrail > 0.5 && varyings.vTime < trips.currentTime - trips.trailLength)) { discard; }
          if (flameColor.a <= 0.0 || (trips.fadeTrail > 0.5 && trips.trailLength <= 0.0)) { discard; }`
        )
        .replace(
          /return deckgl_premultiplied_alpha\((color|varyings.vColor)\);/g,
          'return flameTrail_output($1, flameColor, varyings.flamePickingColor);'
        );
      return {
        ...shaders,
        source: `${inject['vs:#decl']}\n${source}`,
        modules: [...shaders.modules, tripsPlugin.module, FLAME_UNIFORMS],
        plugins: shaders.plugins.filter(plugin => plugin !== tripsPlugin),
        defines: {
          ...shaders.defines,
          ...(shaders.modules.some(module => module.name === 'terrain') && {FLAME_TRAIL_TERRAIN: 1})
        }
      };
    }
    return {
      ...shaders,
      modules: [...shaders.modules, FLAME_UNIFORMS],
      defines: {
        ...shaders.defines,
        ...(shaders.modules.some(module => module.name === 'terrain') && {FLAME_TRAIL_TERRAIN: 1})
      },
      plugins: [
        ...shaders.plugins,
        {
          name: 'flame-trail',
          injections: {
            'glsl:vs:#decl': FLAME_VERTEX_DECLARATIONS,
            'glsl:vs:#main-end': FLAME_VERTEX,
            'glsl:fs:#decl': FLAME_FUNCTIONS,
            'glsl:fs:DECKGL_FILTER_COLOR': `
            if (trips.fadeTrail && trips.trailLength <= 0.0) discard;
            ${FLAME_COLOR}`
          }
        }
      ]
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
