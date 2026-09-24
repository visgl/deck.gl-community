// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {sampleWindField, type WindField, type WindSample} from './wind-data';

/**
 * A row-major float raster containing direction, speed, temperature, and elevation.
 *
 * @remarks
 * Each pixel contains four consecutive `Float32Array` entries. Invalid or uncovered
 * geographic positions retain four zero-valued entries.
 */
export type WindRaster = {
  /** Number of geographic samples per row. */
  width: number;
  /** Number of geographic sample rows. */
  height: number;
  /** Row-major `[direction, speed, temperature, elevation]` samples. */
  data: Float32Array;
};

/** Options for rasterizing a Delaunay-interpolated wind field. */
export type DelaunayInterpolationProps = {
  /** Indexed station forecast returned by {@link createWindField}. */
  field: WindField;
  /** Raster width in pixels; defaults to `256`. */
  width?: number;
  /** Optional raster height; otherwise inferred from the geographic aspect ratio. */
  height?: number;
};

/**
 * Rasterizes or directly samples station measurements using Delaunay interpolation.
 *
 * Unlike the original showcase's off-screen WebGL transform, this implementation can be
 * shared by WebGL, WebGPU, server-side preprocessing, and deterministic tests.
 *
 * @remarks
 * The wind APIs are work in progress. This utility intentionally performs explicit CPU
 * sampling; {@link ParticleLayer} separately caches GPU weather textures and advances
 * particle positions on the active graphics device.
 *
 * @example
 * ```ts
 * const interpolation = new DelaunayInterpolation({field, width: 128, height: 64});
 * const sample = interpolation.sample([-97, 38], 12.5);
 * const raster = interpolation.rasterize(12.5);
 * ```
 */
export class DelaunayInterpolation {
  /** Shared, indexed station forecast. */
  readonly field: WindField;
  /** Raster width in pixels. */
  readonly width: number;
  /** Raster height in pixels. */
  readonly height: number;

  /**
   * Creates a reusable interpolation wrapper for a geographic wind field.
   *
   * @param options - Field and output raster dimensions.
   * @throws RangeError if either provided raster dimension is smaller than two.
   */
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

  /**
   * Samples a geographic position at a fractional, cyclic forecast time.
   *
   * @param position - Geographic `[longitude, latitude]` coordinates.
   * @param time - Fractional forecast frame; defaults to the first frame.
   * @returns Interpolated weather, or `null` outside station coverage.
   */
  sample(position: readonly [number, number], time = 0): WindSample | null {
    return sampleWindField(this.field, position, time);
  }

  /**
   * Rasterizes one weather frame without materializing the full forecast animation.
   *
   * @param time - Fractional forecast frame; defaults to the first frame.
   * @returns Row-major direction, speed, temperature, and elevation samples.
   */
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
