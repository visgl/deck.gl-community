// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type Color, type DefaultProps, type UpdateParameters} from '@deck.gl/core';
import {LineLayer, ScatterplotLayer} from '@deck.gl/layers';
import type {ShaderModule} from '@luma.gl/shadertools';

import {GpuParticlePointLayer} from './gpu-particle-point-layer';
import {GpuParticleSimulation} from './gpu-particle-simulation';
import {sampleWindField, type WindBounds, type WindField} from './wind-data';

/**
 * Configuration for the work-in-progress, GPU-advected {@link ParticleLayer}.
 *
 * @remarks
 * WebGL2 uses transform feedback and point primitives; WebGPU uses compute and portable
 * point sublayers. Particle positions are not read back during animation.
 */
export type ParticleLayerProps = {
  /** Indexed, time-varying weather station data. */
  windField: WindField;
  /** Fractional, cyclic forecast and animation time; defaults to `0`. */
  time?: number;
  /** Number of GPU-resident animated particles; defaults to `2400`. */
  numParticles?: number;
  /** Maximum CPU-fallback trail history; defaults to `12`. */
  trailLength?: number;
  /** Geographic distance per 30-fps-equivalent simulation step; defaults to `0.085`. */
  speedScale?: number;
  /** Minimum on-screen trail width in pixels; defaults to `1.1`. */
  widthMinPixels?: number;
  /** RGBA trail color, modulated by GPU particle lifetime. */
  color?: Color;
  /** Station-elevation multiplier; defaults to `1`. */
  elevationScale?: number;
  /** Separation above station-interpolated terrain in meters; defaults to `160`. */
  surfaceOffset?: number;
  /** Radius of each moving particle head in pixels; defaults to `1.6`. */
  pointRadiusPixels?: number;
};

type ParticlePosition = [number, number, number];
type Particle = {
  seed: number;
  positions: ParticlePosition[];
  direction?: number;
  speed?: number;
};
type BinaryParticleSegments = {
  length: number;
  attributes: {
    getSourcePosition: {value: Float32Array; size: 3};
    getTargetPosition: {value: Float32Array; size: 3};
    getColor: {value: Uint8Array; size: 4};
  };
};

/** GPU particle buffers contain float32 geographic positions, not split fp64 attributes. */
const windParticleTrailClip = {
  name: 'windParticleTrailClip',
  inject: {
    'vs:DECKGL_FILTER_GL_POSITION': `
      if (distance(geometry.worldPosition.xy, geometry.worldPositionAlt.xy) > 0.75) {
        position = vec4(2.0, 2.0, 2.0, 1.0);
      }
    `
  }
} as const satisfies ShaderModule;

const windParticleAgeFade = {
  name: 'windParticleAgeFade',
  inject: {
    'vs:#decl': 'in float windParticleAges;',
    'vs:DECKGL_FILTER_COLOR': `
      float windFadeIn = smoothstep(0.0, 16.0, windParticleAges);
      float windFadeOut = 1.0 - smoothstep(152.0, 180.0, windParticleAges);
      color.a *= windFadeIn * windFadeOut;
    `
  }
} as const satisfies ShaderModule;

class GpuParticleTrailLayer extends LineLayer {
  static layerName = 'GpuParticleTrailLayer';

  initializeState(): void {
    super.initializeState();
    if (this.context.device.type === 'webgl') {
      this.getAttributeManager()?.addInstanced({
        windParticleAges: {size: 1, accessor: 'getParticleAge'}
      });
    }
  }

  getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      modules: [
        ...shaders.modules,
        windParticleTrailClip,
        ...(this.context.device.type === 'webgl' ? [windParticleAgeFade] : [])
      ]
    };
  }

  use64bitPositions(): boolean {
    return false;
  }
}

/** GPU-computed particle heads use the same tightly packed float32 positions. */
class GpuParticleHeadLayer extends ScatterplotLayer {
  static layerName = 'GpuParticleHeadLayer';

  initializeState(): void {
    super.initializeState();
    if (this.context.device.type === 'webgl') {
      this.getAttributeManager()?.addInstanced({
        windParticleAges: {size: 1, accessor: 'getParticleAge'}
      });
    }
  }

  getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      modules: [
        ...shaders.modules,
        ...(this.context.device.type === 'webgl' ? [windParticleAgeFade] : [])
      ]
    };
  }

  use64bitPositions(): boolean {
    return false;
  }
}

const PARTICLE_FRAME_RATE = 30;
const WEATHER_FRAME_DURATION_MS = 1800;

const defaultProps: DefaultProps<ParticleLayerProps> = {
  windField: {type: 'object', value: undefined!},
  time: 0,
  numParticles: 2400,
  trailLength: 12,
  speedScale: 0.085,
  widthMinPixels: 1.1,
  color: [194, 246, 224, 210],
  elevationScale: 1,
  surfaceOffset: 160,
  pointRadiusPixels: 1.6
};

function random(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function createParticlePosition(
  bounds: WindBounds,
  seed: number,
  field: WindField,
  time: number,
  elevationScale: number,
  surfaceOffset: number
): ParticlePosition {
  for (let attempt = 0; attempt < 12; attempt++) {
    const attemptSeed = seed + attempt * 19.19;
    const longitude = bounds.minLng + random(attemptSeed) * (bounds.maxLng - bounds.minLng);
    const latitude = bounds.minLat + random(attemptSeed + 7.13) * (bounds.maxLat - bounds.minLat);
    const sample = sampleWindField(field, [longitude, latitude], time);
    if (sample) {
      return [longitude, latitude, sample.elevation * elevationScale + surfaceOffset];
    }
  }
  return [(bounds.minLng + bounds.maxLng) / 2, (bounds.minLat + bounds.maxLat) / 2, surfaceOffset];
}

/**
 * Advects fading particle trails through a Delaunay-interpolated wind field.
 *
 * Keeps particle positions and advection on the GPU: WebGL uses transform feedback and WebGPU
 * uses a compute shader. Built-in deck.gl layers render directly from the ping-pong GPU buffers.
 * The CPU fallback is retained for lightweight, device-free construction and unit testing.
 *
 * @remarks
 * This API is a work in progress. Preserve the layer `id` while updating `time`; deck.gl
 * transfers the existing simulation state instead of recreating the GPU particle buffers.
 * At high densities the renderer prioritizes single-vertex particle heads over extra trails.
 *
 * @example
 * ```ts
 * new ParticleLayer({
 *   id: 'wind-particles',
 *   windField,
 *   time: 12.5,
 *   numParticles: 100_000,
 *   color: [186, 233, 223, 34]
 * });
 * ```
 */
export class ParticleLayer extends CompositeLayer<ParticleLayerProps> {
  static layerName = 'ParticleLayer';
  static defaultProps: DefaultProps<ParticleLayerProps> = defaultProps;

  declare state: {particles: Particle[]; lastTime: number; gpu?: GpuParticleSimulation};

  /** Seeds particles reproducibly throughout the measured station coverage. */
  initializeState(): void {
    const {device} = this.context || {};
    if (device?.type === 'webgl' || device?.type === 'webgpu') {
      const gpu = new GpuParticleSimulation(
        device,
        this.props.windField,
        this.props.numParticles,
        this.props.surfaceOffset
      );
      gpu.advance(
        this.props.time,
        this.props.speedScale,
        this.props.elevationScale,
        this.props.surfaceOffset,
        0.2
      );
      this.setState({gpu, particles: [], lastTime: this.props.time});
      return;
    }

    this.setState({particles: this.createParticles(), lastTime: this.props.time});
  }

  /** Re-seeds on field changes and advances existing trails when animation time changes. */
  updateState({props, oldProps, changeFlags}: UpdateParameters<this>): void {
    if (this.state.gpu) {
      if (
        changeFlags.dataChanged ||
        props.windField !== oldProps.windField ||
        props.numParticles !== oldProps.numParticles
      ) {
        this.state.gpu.destroy();
        const gpu = new GpuParticleSimulation(
          this.context.device,
          props.windField,
          props.numParticles,
          props.surfaceOffset
        );
        gpu.advance(props.time, props.speedScale, props.elevationScale, props.surfaceOffset, 0.2);
        this.setState({gpu, particles: [], lastTime: props.time});
        return;
      }

      if (props.time !== this.state.lastTime) {
        const elapsedFrames =
          Math.abs(props.time - this.state.lastTime) *
          (WEATHER_FRAME_DURATION_MS / (1000 / PARTICLE_FRAME_RATE));
        this.state.gpu.advance(
          props.time,
          props.speedScale,
          props.elevationScale,
          props.surfaceOffset,
          Math.max(0.2, Math.min(elapsedFrames, 3))
        );
        this.setState({lastTime: props.time});
      }
      return;
    }

    if (
      changeFlags.dataChanged ||
      props.windField !== oldProps.windField ||
      props.numParticles !== oldProps.numParticles
    ) {
      this.setState({particles: this.createParticles(), lastTime: props.time});
      return;
    }

    if (props.time !== this.state.lastTime) {
      const elapsedFrames =
        Math.abs(props.time - this.state.lastTime) *
        (WEATHER_FRAME_DURATION_MS / (1000 / PARTICLE_FRAME_RATE));
      this.advanceParticles(Math.max(0.2, Math.min(elapsedFrames, 3)));
      this.setState({lastTime: props.time});
    }
  }

  private createParticles(): Particle[] {
    const {windField, time, numParticles, elevationScale, surfaceOffset} = this.props;
    if (!windField) {
      return [];
    }
    return Array.from({length: Math.max(0, Math.floor(numParticles))}, (_, index) => {
      const seed = index + 1;
      return {
        seed,
        positions: [
          createParticlePosition(
            windField.bounds,
            seed,
            windField,
            time,
            elevationScale,
            surfaceOffset
          )
        ]
      };
    });
  }

  private advanceParticles(elapsedFrames: number): void {
    const {windField, time, trailLength, speedScale, elevationScale, surfaceOffset} = this.props;
    const speedSpan = Math.max(windField.speedRange[1] - windField.speedRange[0], 1);

    for (const particle of this.state.particles) {
      const previous = particle.positions[particle.positions.length - 1];
      const sample = sampleWindField(windField, [previous[0], previous[1]], time);
      if (!sample || sample.speed <= 0) {
        particle.seed += 101.7;
        particle.direction = undefined;
        particle.speed = undefined;
        particle.positions = [
          createParticlePosition(
            windField.bounds,
            particle.seed,
            windField,
            time,
            elevationScale,
            surfaceOffset
          )
        ];
        continue;
      }

      const normalizedSpeed =
        0.18 + Math.sqrt(Math.max(0, (sample.speed - windField.speedRange[0]) / speedSpan)) * 0.82;
      const smoothing = Math.min(0.18 * elapsedFrames, 1);
      const previousDirection = particle.direction ?? sample.direction;
      const direction = Math.atan2(
        Math.sin(previousDirection) * (1 - smoothing) + Math.sin(sample.direction) * smoothing,
        Math.cos(previousDirection) * (1 - smoothing) + Math.cos(sample.direction) * smoothing
      );
      const previousSpeed = particle.speed ?? normalizedSpeed;
      const speed = previousSpeed + (normalizedSpeed - previousSpeed) * smoothing;
      const distance = speed * speedScale * elapsedFrames;
      const next: ParticlePosition = [
        previous[0] + Math.cos(direction) * distance,
        previous[1] + Math.sin(direction) * distance,
        sample.elevation * elevationScale + surfaceOffset
      ];

      if (
        next[0] < windField.bounds.minLng ||
        next[0] > windField.bounds.maxLng ||
        next[1] < windField.bounds.minLat ||
        next[1] > windField.bounds.maxLat
      ) {
        particle.seed += 101.7;
        particle.direction = undefined;
        particle.speed = undefined;
        particle.positions = [
          createParticlePosition(
            windField.bounds,
            particle.seed,
            windField,
            time,
            elevationScale,
            surfaceOffset
          )
        ];
        continue;
      }

      particle.direction = direction;
      particle.speed = speed;
      particle.positions.push(next);
      if (particle.positions.length > Math.max(2, Math.floor(trailLength))) {
        particle.positions.shift();
      }
    }
  }

  /** Streams faded particle trails to GPU layers as compact binary attributes. */
  renderLayers() {
    if (!this.state?.particles) {
      return null;
    }

    const {color, widthMinPixels, pointRadiusPixels, time} = this.props;
    if (this.state.gpu) {
      const {gpu} = this.state;
      const positions = {
        length: gpu.particleCount,
        attributes: {
          getSourcePosition: {buffer: gpu.sourceBuffer, size: 3, stride: 16},
          getTargetPosition: {buffer: gpu.targetBuffer, size: 3, stride: 16},
          getPosition: {buffer: gpu.targetBuffer, size: 3, stride: 16},
          getParticleAge: {buffer: gpu.targetBuffer, size: 1, stride: 16, offset: 12}
        }
      };

      const heads =
        this.context.device.type === 'webgl'
          ? new GpuParticlePointLayer(this.getSubLayerProps({id: 'heads'}), {
              simulation: gpu,
              color: [237, 247, 255, Math.min(255, (color[3] ?? 255) + 12)],
              pointRadiusPixels,
              pickable: false
            })
          : new GpuParticleHeadLayer(this.getSubLayerProps({id: 'heads'}), {
              data: positions,
              getFillColor: [237, 247, 255, Math.min(255, (color[3] ?? 255) + 12)],
              getRadius: pointRadiusPixels,
              radiusUnits: 'pixels',
              radiusMinPixels: pointRadiusPixels,
              billboard: true,
              parameters: {depthWriteEnabled: false},
              pickable: false
            });
      if (gpu.particleCount > 250_000) {
        return [heads];
      }

      return [
        new GpuParticleTrailLayer(this.getSubLayerProps({id: 'trails'}), {
          data: positions,
          getColor: color,
          getWidth: 1,
          widthUnits: 'pixels',
          widthMinPixels,
          parameters: {depthWriteEnabled: false},
          pickable: false
        }),
        heads
      ];
    }

    const segmentCount = this.state.particles.reduce(
      (count, particle) => count + Math.max(0, particle.positions.length - 1),
      0
    );
    const sourcePositions = new Float32Array(segmentCount * 3);
    const targetPositions = new Float32Array(segmentCount * 3);
    const colors = new Uint8Array(segmentCount * 4);
    let segmentIndex = 0;

    for (const particle of this.state.particles) {
      for (let index = 1; index < particle.positions.length; index++) {
        const opacity = index / Math.max(1, particle.positions.length - 1);
        sourcePositions.set(particle.positions[index - 1], segmentIndex * 3);
        targetPositions.set(particle.positions[index], segmentIndex * 3);
        colors.set(
          [color[0], color[1], color[2], Math.round((color[3] ?? 255) * opacity)],
          segmentIndex * 4
        );
        segmentIndex++;
      }
    }

    const segments: BinaryParticleSegments = {
      length: segmentCount,
      attributes: {
        getSourcePosition: {value: sourcePositions, size: 3},
        getTargetPosition: {value: targetPositions, size: 3},
        getColor: {value: colors, size: 4}
      }
    };

    return [
      new LineLayer(this.getSubLayerProps({id: 'trails'}), {
        data: segments,
        getWidth: 1,
        widthUnits: 'pixels',
        widthMinPixels,
        parameters: {depthWriteEnabled: false},
        pickable: false
      }),
      new ScatterplotLayer<Particle>(this.getSubLayerProps({id: 'heads'}), {
        data: this.state.particles,
        getPosition: particle => particle.positions[particle.positions.length - 1],
        getFillColor: [255, 255, 255, Math.min(255, (color[3] ?? 255) + 24)],
        getRadius: pointRadiusPixels,
        radiusUnits: 'pixels',
        radiusMinPixels: pointRadiusPixels,
        billboard: true,
        updateTriggers: {getPosition: time},
        parameters: {depthWriteEnabled: false},
        pickable: false
      })
    ];
  }

  /** Releases the ping-pong particle buffers, weather textures, and GPU pipeline. */
  finalizeState(): void {
    this.state?.gpu?.destroy();
    super.finalizeState(this.context);
  }
}
