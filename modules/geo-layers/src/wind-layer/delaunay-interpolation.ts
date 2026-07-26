// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {sampleWindField, type WindField, type WindSample} from './wind-data';

/** An RGBA float raster containing direction, speed, temperature, and elevation. */
export type WindRaster = {
  width: number;
  height: number;
  data: Float32Array;
};

/** Options for rasterizing a Delaunay-interpolated wind field. */
export type DelaunayInterpolationProps = {
  field: WindField;
  width?: number;
  height?: number;
};

/**
 * Rasterizes or directly samples station measurements using Delaunay interpolation.
 *
 * Unlike the original showcase's off-screen WebGL transform, this implementation can be
 * shared by WebGL, WebGPU, server-side preprocessing, and deterministic tests.
 */
export class DelaunayInterpolation {
  readonly field: WindField;
  readonly width: number;
  readonly height: number;

  constructor({field, width = 256, height}: DelaunayInterpolationProps) {
    if (!Number.isInteger(width) || width < 2) {
      throw new RangeError('A wind raster width must be an integer greater than one.');
    }
    const {bounds} = field;
    const inferredHeight = Math.max(
      2,
      Math.ceil(
        (width * (bounds.maxLat - bounds.minLat)) /
          Math.max(bounds.maxLng - bounds.minLng, Number.EPSILON)
      )
    );
    if (height !== undefined && (!Number.isInteger(height) || height < 2)) {
      throw new RangeError('A wind raster height must be an integer greater than one.');
    }
    this.field = field;
    this.width = width;
    this.height = height ?? inferredHeight;
  }

  /** Samples a geographic position at a fractional, cyclic weather-frame time. */
  sample(position: readonly [number, number], time = 0): WindSample | null {
    return sampleWindField(this.field, position, time);
  }

  /** Rasterizes one time step without eagerly materializing the complete weather animation. */
  rasterize(time = 0): WindRaster {
    const {bounds} = this.field;
    const data = new Float32Array(this.width * this.height * 4);

    for (let y = 0; y < this.height; y++) {
      const latitude = bounds.minLat + (y / (this.height - 1)) * (bounds.maxLat - bounds.minLat);
      for (let x = 0; x < this.width; x++) {
        const longitude = bounds.minLng + (x / (this.width - 1)) * (bounds.maxLng - bounds.minLng);
        const sample = this.sample([longitude, latitude], time);
        if (!sample) {
          continue;
        }
        const offset = (y * this.width + x) * 4;
        data[offset] = sample.direction;
        data[offset + 1] = sample.speed;
        data[offset + 2] = sample.temperature;
        data[offset + 3] = sample.elevation;
      }
    }

    return {width: this.width, height: this.height, data};
  }
}
