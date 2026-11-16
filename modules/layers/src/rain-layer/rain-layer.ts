// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {fp64LowPart, Layer, project32} from '@deck.gl/core';
import type {Color, DefaultProps, LayerProps, Position} from '@deck.gl/core';
import type {RenderPipelineParameters} from '@luma.gl/core';
import {Model} from '@luma.gl/engine';
import {rainUniforms, RAIN_FS, RAIN_VS, RAIN_WGSL} from './rain-layer-shaders';

type _RainLayerProps = {
  /** Center of the rain volume in the layer's coordinate system. */
  position: Position;
  /** Width, depth, and height of the rain volume in meters. */
  size?: readonly [number, number, number];
  /** Velocity along the local x, y, and z axes in meters per second. */
  velocity?: readonly [number, number, number];
  /** Number of drops in the volume. */
  count?: number;
  /** Time in seconds. Applications advance this value to animate the rain. */
  time?: number;
  /** Shutter exposure in seconds. Streak length is speed multiplied by exposure. */
  exposure?: number;
  /** Streak width in CSS pixels. */
  streakWidth?: number;
  /** Streak color as an RGB or RGBA byte tuple. */
  color?: Color;
  /** Unsigned 32-bit seed for the initial drop distribution. */
  seed?: number;
};

export type RainLayerProps = LayerProps & _RainLayerProps;

const defaultProps: DefaultProps<RainLayerProps> & {shadowEnabled: boolean} = {
  position: {type: 'array', value: [0, 0, 0], compare: true},
  size: {type: 'array', value: [200, 200, 80], compare: true},
  velocity: {type: 'array', value: [0, 0, -8.5], compare: true},
  count: {type: 'number', value: 2048, min: 0},
  time: {type: 'number', value: 0},
  exposure: {type: 'number', value: 1 / 60, min: 0},
  streakWidth: {type: 'number', value: 1.5, min: 0},
  color: {type: 'color', value: [200, 220, 235, 128]},
  seed: {type: 'number', value: 0},
  shadowEnabled: false
};

const RAIN_PARAMETERS: RenderPipelineParameters = {
  blend: true,
  blendColorSrcFactor: 'one',
  blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
  cullMode: 'none',
  depthCompare: 'less-equal',
  depthWriteEnabled: false
};

/** Draws deterministic rain streaks within a world-space volume. */
export class RainLayer extends Layer<Required<_RainLayerProps>> {
  static layerName = 'RainLayer';
  static defaultProps = defaultProps;

  declare state: {model: Model};

  getShaders() {
    return super.getShaders({
      vs: RAIN_VS,
      fs: RAIN_FS,
      source: RAIN_WGSL,
      modules: [project32, rainUniforms]
    });
  }

  initializeState(): void {
    this.getAttributeManager()?.remove(['instancePickingColors']);
    this.setState({
      model: new Model(this.context.device, {
        ...this.getShaders(),
        id: this.props.id,
        topology: 'triangle-strip',
        vertexCount: 4,
        isInstanced: true,
        parameters: RAIN_PARAMETERS
      })
    });
  }

  getNumInstances(): number {
    const {count} = this.props;
    return Number.isFinite(count) ? Math.min(Math.max(0, Math.floor(count)), 0x7fffffff) : 0;
  }

  isPickable(): boolean {
    return false;
  }

  draw({shaderModuleProps}: {shaderModuleProps?: {shadow?: {drawToShadowMap?: boolean}}}): void {
    const {model} = this.state;
    const {position, size, velocity, exposure, streakWidth, color, time, seed} = this.props;
    if (
      shaderModuleProps?.shadow?.drawToShadowMap ||
      !this.getNumInstances() ||
      !(exposure > 0 && Number.isFinite(exposure)) ||
      !(streakWidth > 0 && Number.isFinite(streakWidth)) ||
      !Number.isFinite(time) ||
      !velocity.every(Number.isFinite) ||
      !size.every(dimension => Number.isFinite(dimension) && dimension > 0)
    ) {
      return;
    }
    const center = [position[0], position[1], position[2] ?? 0];
    model.shaderInputs.setProps({
      rain: {
        center,
        center64Low: center.map(fp64LowPart),
        size,
        // Reduce displacement to one period before converting to GPU floats.
        phase: size.map((dimension, axis) => ((time * velocity[axis]) % dimension) / dimension),
        halfStreak: velocity.map(speed => (speed * exposure) / 2),
        streakWidth,
        color: [color[0] / 255, color[1] / 255, color[2] / 255, (color[3] ?? 255) / 255],
        seed: seed >>> 0
      }
    });
    // Deck applies its pass defaults before draw, including WebGPU depth writes.
    model.setParameters({...model.parameters, ...RAIN_PARAMETERS});
    model.draw(this.context.renderPass);
  }
}
