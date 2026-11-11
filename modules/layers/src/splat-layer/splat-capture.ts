// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {SplatSource} from './splat-source';

/** RGBA32UI texels per Gaussian in a packed capture. */
export const SPLAT_CAPTURE_TEXELS = 2;
/** Widest data texture a capture uses; even, so a Gaussian's two texels share a row. */
const MAX_TEXTURE_WIDTH = 4096;
/** Log2 importance buckets for the budget order. */
const IMPORTANCE_BUCKETS = 4096;

/** The colour range a capture's RGB bytes span, so DC colour stays unclamped until the SH bands add. */
export const SPLAT_CAPTURE_COLOR_RANGE = [-0.5, 1.5];

/**
 * One scan packed for the GPU: two RGBA32UI texels per Gaussian, most important first, so any
 * `maxSplats` budget draws a prefix of it.
 * - texel 0: centre XYZ as float bits, then RGB bytes over `SPLAT_CAPTURE_COLOR_RANGE` and an
 *   opacity byte
 * - texel 1: half-float pairs (scale X, scale Y), (scale Z, rotation W), (rotation X, Y), (rotation Z, 0)
 *
 * Scale and rotation stay separate, rather than a half-float covariance, so a thin Gaussian keeps its
 * exact thickness however long it is. Spherical-harmonic bands, when the source has them, pack as
 * SPZ bytes into 1, 2 or 3 more texels per Gaussian in a texture of their own.
 */
export type SplatCapture = {
  count: number;
  /** `width * height * 4` words. */
  data: Uint32Array;
  width: number;
  height: number;
  /** 0 without higher bands, else 1, 2 or 3. */
  shDegree: number;
  /** RGBA32UI texels of SH bytes per Gaussian: 1, 2 or 3. */
  shTexels: number;
  /** `shWidth * shHeight * 4` words, or null without higher bands. */
  sh: Uint32Array | null;
  shWidth: number;
  shHeight: number;
  /** Centre XYZ and largest sigma in packed order, four floats per Gaussian, for the depth sort. */
  bounds: Float32Array;
  /** Mip-Splatting's 2D filter: compensate opacity for the screen-space dilation. */
  antialiased: boolean;
};

const CAPTURES = new WeakMap<SplatSource, SplatCapture>();

/** The packed capture of a source, built once per source. */
export function getSplatCapture(source: SplatSource, maxTextureSize = 8192): SplatCapture {
  let capture = CAPTURES.get(source);
  if (!capture) {
    capture = packSplatCapture(source, maxTextureSize);
    CAPTURES.set(source, capture);
  }
  return capture;
}

/** Pack a source into a capture; see `SplatCapture` for the layout. */
export function packSplatCapture(source: SplatSource, maxTextureSize = 8192): SplatCapture {
  const count = source.positions.length / 3;
  const width = Math.min(MAX_TEXTURE_WIDTH, maxTextureSize - (maxTextureSize % 2));
  const height = Math.max(1, Math.ceil((count * SPLAT_CAPTURE_TEXELS) / width));
  if (height > maxTextureSize)
    throw new Error(
      `SplatLayer cannot draw ${count} Gaussians as one capture: the device holds at most ${Math.floor((width * maxTextureSize) / SPLAT_CAPTURE_TEXELS)}.`
    );
  const coefficients = source.sphericalHarmonics ? source.sphericalHarmonics.length / count / 3 : 0;
  const shDegree = {0: 0, 3: 1, 8: 2, 15: 3}[coefficients];
  if (shDegree === undefined)
    throw new Error('Splat sphericalHarmonics must hold 3, 8 or 15 RGB coefficients per Gaussian.');
  const shTexels = Math.ceil((coefficients * 3) / 16);
  const shHeight = shTexels ? Math.ceil((count * shTexels) / width) : 0;
  if (shHeight > maxTextureSize)
    throw new Error(
      `SplatLayer cannot hold the spherical harmonics of ${count} Gaussians on this device.`
    );
  const order = getSplatImportanceOrder(source);
  const data = new Uint32Array(width * height * 4);
  const words = new Float32Array(data.buffer);
  const sh = shTexels ? new Uint32Array(width * shHeight * 4) : null;
  const shBytes = sh ? new Uint8Array(sh.buffer) : null;
  const bands = source.sphericalHarmonics;
  const floatBands = bands instanceof Float32Array;
  const bounds = new Float32Array(count * 4);
  const {positions, scales, rotations, colors, opacities, opticalDepths} = source;
  const floatColors = colors instanceof Float32Array;
  const [low, high] = SPLAT_CAPTURE_COLOR_RANGE;
  for (let packed = 0; packed < count; packed++) {
    const i = order[packed];
    const offset = packed * 8;
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i * 3 + axis];
      words[offset + axis] = value;
      bounds[packed * 4 + axis] = value;
    }
    bounds[packed * 4 + 3] = Math.max(scales[i * 3], scales[i * 3 + 1], scales[i * 3 + 2]);
    // A colour's alpha multiplies opacity once; optical depth replaces it.
    const peak = opticalDepths ? 1 - Math.exp(-opticalDepths[i]) : opacities[i];
    let rgba = 0;
    for (let channel = 0; channel < 4; channel++) {
      const value = floatColors ? colors[i * 4 + channel] : colors[i * 4 + channel] / 255;
      const byte =
        channel < 3
          ? ((value - low) / (high - low)) * 255
          : value * Math.min(1, Math.max(0, peak)) * 255;
      rgba |= Math.min(255, Math.max(0, Math.round(byte))) << (channel * 8);
    }
    data[offset + 3] = rgba >>> 0;
    if (shBytes && bands) {
      const from = i * coefficients * 3;
      const to = packed * shTexels * 16;
      for (let k = 0; k < coefficients * 3; k++)
        shBytes[to + k] = floatBands
          ? Math.min(255, Math.max(0, Math.round(bands[from + k] * 128 + 128)))
          : bands[from + k];
    }
    data[offset + 4] = packHalf2(scales[i * 3], scales[i * 3 + 1]);
    data[offset + 5] = packHalf2(scales[i * 3 + 2], rotations[i * 4]);
    data[offset + 6] = packHalf2(rotations[i * 4 + 1], rotations[i * 4 + 2]);
    data[offset + 7] = packHalf2(rotations[i * 4 + 3], 0);
  }
  return {
    count,
    data,
    width,
    height,
    shDegree,
    shTexels,
    sh,
    shWidth: width,
    shHeight,
    bounds,
    antialiased: Boolean(source.antialiased)
  };
}

/**
 * Source indices from most to least important: peak opacity times the Gaussian's projected-area
 * proxy, bucketed by log2, stable within a bucket. A budget keeps the first Gaussians.
 */
export function getSplatImportanceOrder(source: SplatSource): Uint32Array {
  const count = source.positions.length / 3;
  const {scales, opacities, opticalDepths, colors} = source;
  const keys = new Float32Array(count);
  let min = Infinity;
  let max = -Infinity;
  const alphaScale = colors instanceof Float32Array ? 1 : 1 / 255;
  for (let i = 0; i < count; i++) {
    const sx = scales[i * 3],
      sy = scales[i * 3 + 1],
      sz = scales[i * 3 + 2];
    const peak = opticalDepths ? 1 - Math.exp(-opticalDepths[i]) : opacities[i];
    const importance = peak * colors[i * 4 + 3] * alphaScale * (sx * sy + sy * sz + sx * sz);
    const key = importance > 0 ? Math.log2(importance) : -Infinity;
    keys[i] = key;
    if (key > -Infinity) {
      min = Math.min(min, key);
      max = Math.max(max, key);
    }
  }
  // the last bucket holds only invisible Gaussians
  const bucketScale = max > min ? (IMPORTANCE_BUCKETS - 2) / (max - min) : 0;
  const buckets = new Uint16Array(count);
  const starts = new Uint32Array(IMPORTANCE_BUCKETS + 1);
  for (let i = 0; i < count; i++) {
    // bucket 0 is the most important; invisible Gaussians go last
    const bucket =
      keys[i] > -Infinity ? Math.floor((max - keys[i]) * bucketScale) : IMPORTANCE_BUCKETS - 1;
    buckets[i] = bucket;
    starts[bucket + 1]++;
  }
  for (let bucket = 0; bucket < IMPORTANCE_BUCKETS; bucket++) starts[bucket + 1] += starts[bucket];
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[starts[buckets[i]]++] = i;
  return order;
}

const FLOAT = new Float32Array(1);
const BITS = new Uint32Array(FLOAT.buffer);

/** IEEE half-float bits of a number, rounded to nearest, clamped to the largest finite half. */
export function toHalfFloat(value: number): number {
  FLOAT[0] = value;
  const bits = BITS[0];
  const sign = (bits >>> 16) & 0x8000;
  const exponent = ((bits >>> 23) & 0xff) - 112;
  const mantissa = bits & 0x7fffff;
  if (exponent >= 31) return ((bits >>> 23) & 0xff) === 0xff && mantissa ? 0x7e00 : sign | 0x7bff;
  if (exponent <= 0) {
    if (exponent < -10) return sign;
    const shift = 14 - exponent;
    const full = mantissa | 0x800000;
    return sign | ((full >>> shift) + ((full >>> (shift - 1)) & 1));
  }
  return sign | Math.min(0x7bff, ((exponent << 10) | (mantissa >>> 13)) + ((mantissa >>> 12) & 1));
}

function packHalf2(low: number, high: number): number {
  return (toHalfFloat(low) | (toHalfFloat(high) << 16)) >>> 0;
}
