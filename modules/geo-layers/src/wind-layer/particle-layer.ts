// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, type Color, type DefaultProps, type UpdateParameters} from '@deck.gl/core';
import {LineLayer, ScatterplotLayer} from '@deck.gl/layers';

import {sampleWindField, type WindBounds, type WindField} from './wind-data';

/** Properties for animated wind-field particle trails. */
export type ParticleLayerProps = {
  /** Indexed, time-varying weather station data. */
  windField: WindField;
  /** Fractional weather-frame and animation time. */
  time?: number;
  /** Number of continuously advected particles. */
  numParticles?: number;
  /** Number of historical positions retained in each trail. */
  trailLength?: number;
  /** Geographic distance advanced per elapsed, 30-frame-per-second animation step. */
  speedScale?: number;
  /** Screen-space trail width in pixels. */
  widthMinPixels?: number;
  /** Trail color; opacity increases toward each particle's current position. */
  color?: Color;
  /** Elevation multiplier applied to interpolated station elevation. */
  elevationScale?: number;
  /** Vertical separation above the shaded terrain surface, in meters. */
  surfaceOffset?: number;
  /** Radius in pixels of each bright, moving particle head. */
  pointRadiusPixels?: number;
};

type ParticlePosition = [number, number, number];
type Particle = {
  seed: number;
  positions: ParticlePosition[];
  direction?: number;
  speed?: number;
};
type ParticleSegment = {source: ParticlePosition; target: ParticlePosition; color: Color};

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
 * Particle positions are backend independent, while built-in deck.gl line sublayers handle
 * instanced GPU rendering on both WebGL and WebGPU.
 */
export class ParticleLayer extends CompositeLayer<ParticleLayerProps> {
  static layerName = 'ParticleLayer';
  static defaultProps: DefaultProps<ParticleLayerProps> = defaultProps;

  declare state: {particles: Particle[]; lastTime: number};

  /** Seeds particles reproducibly throughout the measured station coverage. */
  initializeState(): void {
    this.setState({particles: this.createParticles(), lastTime: this.props.time});
  }

  /** Re-seeds on field changes and advances existing trails when animation time changes. */
  updateState({props, oldProps, changeFlags}: UpdateParameters<this>): void {
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

      if (!sampleWindField(windField, [next[0], next[1]], time)) {
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

  /** Renders independently faded, GPU-instanced trail segments. */
  renderLayers() {
    if (!this.state?.particles) {
      return null;
    }

    const {color, widthMinPixels, pointRadiusPixels} = this.props;
    const segments: ParticleSegment[] = [];
    for (const particle of this.state.particles) {
      for (let index = 1; index < particle.positions.length; index++) {
        const opacity = index / Math.max(1, particle.positions.length - 1);
        segments.push({
          source: particle.positions[index - 1],
          target: particle.positions[index],
          color: [color[0], color[1], color[2], Math.round((color[3] ?? 255) * opacity)]
        });
      }
    }

    return [
      new LineLayer<ParticleSegment>(this.getSubLayerProps({id: 'trails'}), {
        data: segments,
        getSourcePosition: segment => segment.source,
        getTargetPosition: segment => segment.target,
        getColor: segment => segment.color,
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
        parameters: {depthWriteEnabled: false},
        pickable: false
      })
    ];
  }
}
