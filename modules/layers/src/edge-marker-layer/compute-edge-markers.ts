// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {_GlobeViewport as GlobeViewport, type Viewport} from '@deck.gl/core';

/** Where a marker is drawn, relative to its target. */
export const EdgeMarkerState = {
  /** Not drawn: outside the distance range, or hidden by `behindCamera` / `beyondHorizon`. */
  HIDDEN: 0,
  /** Drawn at the projected target position, inside the margins. */
  ON_SCREEN: 1,
  /** In front of the camera, but outside the margins: docked to the margin edge. */
  OFF_SCREEN: 2,
  /** Behind the camera plane: docked to the edge on the side of the target. */
  BEHIND_CAMERA: 3,
  /** GlobeView only: in front of the camera, but the globe hides it. Docked to the edge. */
  BEYOND_HORIZON: 4
} as const;

export type EdgeMarkerState = (typeof EdgeMarkerState)[keyof typeof EdgeMarkerState];

/** Margins of the docking rectangle, in CSS pixels from each viewport edge. */
export type EdgeMarkerMargins = {top: number; right: number; bottom: number; left: number};

export type EdgeMarkerOptions = {
  /** Docking rectangle inset from the viewport edges, in CSS pixels. */
  margins: EdgeMarkerMargins;
  /** Hide targets nearer to the camera than this, in meters. */
  minDistance: number;
  /** Hide targets farther from the camera than this, in meters. */
  maxDistance: number;
  /** Stretch of the docked position away from the horizontal center line. 1 = none. */
  yStretch: number;
  /** Round positions to whole device pixels. */
  integerCoordinates: boolean;
  /** Device pixels per CSS pixel, used by `integerCoordinates`. */
  devicePixelRatio: number;
  /** What to do with a target behind the camera plane. */
  behindCamera: 'dock' | 'hide';
  /** GlobeView only: what to do with a target that the globe hides. */
  beyondHorizon: 'dock' | 'hide' | 'ignore';
};

/** Per-target output. Arrays are reused between calls with the same capacity. */
export type EdgeMarkerFrame = {
  count: number;
  /** Marker position in CSS pixels, top-left origin, interleaved [x0, y0, x1, y1, ...]. */
  positions: Float64Array;
  /** Arrow angle in degrees, counterclockwise on screen from +x (right). 0 for ON_SCREEN. */
  angles: Float32Array;
  /** `EdgeMarkerState` for each target. */
  states: Uint8Array;
  /** Camera-to-target distance in meters. */
  distances: Float64Array;
  /** Pixel that the camera axis projects to (the principal point), CSS pixels. */
  principalPoint: [number, number];
  /** A world position on the camera axis, in front of the camera. It projects to `principalPoint`. */
  anchor: [number, number, number];
  /**
   * Multiply screen-space pixel offsets and sizes by this, for layers drawn at `anchor`.
   * deck.gl billboards size pixels for the focal plane, and the anchor is just in front of it.
   */
  pixelScale: number;
};

export const DEFAULT_EDGE_MARKER_OPTIONS: EdgeMarkerOptions = {
  margins: {top: 24, right: 24, bottom: 24, left: 24},
  minDistance: 0,
  maxDistance: Infinity,
  yStretch: 1,
  integerCoordinates: true,
  devicePixelRatio: 1,
  behindCamera: 'dock',
  beyondHorizon: 'dock'
};

/** Allocate a frame for `count` targets, or reuse `frame` when it is large enough. */
export function createEdgeMarkerFrame(count: number, frame?: EdgeMarkerFrame): EdgeMarkerFrame {
  if (frame && frame.states.length >= count) {
    frame.count = count;
    return frame;
  }
  return {
    count,
    positions: new Float64Array(count * 2),
    angles: new Float32Array(count),
    states: new Uint8Array(count),
    distances: new Float64Array(count),
    principalPoint: [0, 0],
    anchor: [0, 0, 0],
    pixelScale: 1
  };
}

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Compute where each target's marker goes on screen, on the CPU.
 *
 * - Inside the margins, the marker is at the projected target.
 * - Outside the margins, behind the camera, or beyond the globe horizon, the marker docks to the
 *   margin rectangle on the ray from the principal point toward the target. The arrow angle is
 *   the true screen bearing of the target, also for targets behind the camera.
 *
 * The bearing uses homogeneous pixel coordinates `(X - cx * W, Y - cy * W)`. This vector is the
 * camera-space direction of the target in the image plane. It has no perspective divide, so it
 * stays correct when `W <= 0` (behind the camera), where `X / W` mirrors the point.
 *
 * @param positions world positions, flat `[x0, y0, z0, x1, ...]`, in the viewport's world units
 * @param count number of targets
 */
export function computeEdgeMarkers(
  viewport: Viewport,
  positions: ArrayLike<number>,
  count: number,
  options: EdgeMarkerOptions,
  out?: EdgeMarkerFrame
): EdgeMarkerFrame {
  const frame = createEdgeMarkerFrame(count, out);
  const {width, height} = viewport;
  const m = viewport.pixelProjectionMatrix;
  const camera = viewport.cameraPosition;
  const metersPerUnit = viewport.distanceScales.metersPerUnit[0];
  const {margins, minDistance, maxDistance, yStretch, behindCamera, beyondHorizon} = options;
  const ratio = options.integerCoordinates ? options.devicePixelRatio || 1 : 0;

  // Principal point: projection of a point on the camera axis.
  const {anchor: anchorCommon, pixelScale} = getAxisAnchor(viewport);
  frame.anchor = viewport.unprojectPosition(anchorCommon);
  frame.pixelScale = pixelScale;
  const aw = m[3] * anchorCommon[0] + m[7] * anchorCommon[1] + m[11] * anchorCommon[2] + m[15];
  const cx =
    (m[0] * anchorCommon[0] + m[4] * anchorCommon[1] + m[8] * anchorCommon[2] + m[12]) / aw;
  const cy =
    (m[1] * anchorCommon[0] + m[5] * anchorCommon[1] + m[9] * anchorCommon[2] + m[13]) / aw;
  frame.principalPoint[0] = cx;
  frame.principalPoint[1] = cy;

  let left = margins.left;
  let right = width - margins.right;
  let top = margins.top;
  let bottom = height - margins.bottom;
  if (ratio) {
    // Docked markers sit on the margin edge: keep the edge on whole device pixels.
    left = Math.ceil(left * ratio) / ratio;
    right = Math.floor(right * ratio) / ratio;
    top = Math.ceil(top * ratio) / ratio;
    bottom = Math.floor(bottom * ratio) / ratio;
  }
  // The ray origin must be inside the rectangle.
  const ox = Math.min(Math.max(cx, left), right);
  const oy = Math.min(Math.max(cy, top), bottom);

  const globeRadius = viewport instanceof GlobeViewport ? getGlobeRadius(viewport) : 0;
  const {positions: outPositions, angles, states, distances} = frame;

  for (let i = 0; i < count; i++) {
    const p = viewport.projectPosition([
      positions[i * 3],
      positions[i * 3 + 1],
      positions[i * 3 + 2] || 0
    ]);
    const dx0 = p[0] - camera[0];
    const dy0 = p[1] - camera[1];
    const dz0 = p[2] - camera[2];
    const distance = Math.sqrt(dx0 * dx0 + dy0 * dy0 + dz0 * dz0) * metersPerUnit;
    distances[i] = distance;
    angles[i] = 0;
    if (!(distance >= minDistance && distance <= maxDistance)) {
      states[i] = EdgeMarkerState.HIDDEN;
      continue;
    }

    const X = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const Y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const W = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];

    let state: EdgeMarkerState = EdgeMarkerState.ON_SCREEN;
    if (!(W > 0)) {
      state = EdgeMarkerState.BEHIND_CAMERA;
    } else if (
      globeRadius &&
      beyondHorizon !== 'ignore' &&
      isBeyondHorizon(camera, p, globeRadius)
    ) {
      state = EdgeMarkerState.BEYOND_HORIZON;
    }
    if (
      (state === EdgeMarkerState.BEHIND_CAMERA && behindCamera === 'hide') ||
      (state === EdgeMarkerState.BEYOND_HORIZON && beyondHorizon === 'hide')
    ) {
      states[i] = EdgeMarkerState.HIDDEN;
      continue;
    }

    let x: number;
    let y: number;
    if (state === EdgeMarkerState.ON_SCREEN) {
      x = X / W;
      y = Y / W;
      if (x < left || x > right || y < top || y > bottom) {
        state = EdgeMarkerState.OFF_SCREEN;
      }
    }

    if (state !== EdgeMarkerState.ON_SCREEN) {
      // Image-plane direction of the target, valid for any sign of W.
      let dx = X - cx * W;
      let dy = Y - cy * W;
      if (dx === 0 && dy === 0) {
        // On the camera axis, behind the camera: point down.
        dy = 1;
      }
      angles[i] = Math.atan2(-dy, dx) * RAD_TO_DEG;
      dy *= yStretch;
      const tx = dx > 0 ? (right - ox) / dx : dx < 0 ? (left - ox) / dx : Infinity;
      const ty = dy > 0 ? (bottom - oy) / dy : dy < 0 ? (top - oy) / dy : Infinity;
      const t = Math.min(tx, ty);
      x = Math.min(Math.max(ox + dx * t, left), right);
      y = Math.min(Math.max(oy + dy * t, top), bottom);
    }

    if (ratio) {
      x = Math.round(x! * ratio) / ratio;
      y = Math.round(y! * ratio) / ratio;
    }
    outPositions[i * 2] = x!;
    outPositions[i * 2 + 1] = y!;
    states[i] = state;
  }
  return frame;
}

/** Fraction of the focal-plane clip w at which the anchor sits: just in front of the focal plane. */
const ANCHOR_DEPTH = 0.999;

/**
 * A common-space point on the camera axis, just in front of the focal plane.
 *
 * deck.gl sizes billboard pixels for the focal plane: the shader scales pixel offsets and sizes by
 * `focalW / anchorW`. The returned `pixelScale = anchorW / focalW` undoes that. The anchor is a
 * little in front of the plane, so that the globe occlusion test never hides it.
 */
function getAxisAnchor(viewport: Viewport): {anchor: number[]; pixelScale: number} {
  const camera = viewport.cameraPosition;
  const inv = viewport.viewMatrixInverse;
  // View space looks down -z: world forward is -(third column of the inverse view matrix).
  let fx = -inv[8];
  let fy = -inv[9];
  let fz = -inv[10];
  const flen = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  fx /= flen;
  fy /= flen;
  fz /= flen;
  // Same value as the `project.focalDistance` uniform.
  const p = viewport.projectionMatrix;
  const focalW = p[11] * -viewport.focalDistance + p[15] || 1;
  // Clip w along the axis: w(t) = w0 + t * wf.
  const m = viewport.pixelProjectionMatrix;
  const w0 = m[3] * camera[0] + m[7] * camera[1] + m[11] * camera[2] + m[15];
  const wf = m[3] * fx + m[7] * fy + m[11] * fz;
  const t = (focalW * ANCHOR_DEPTH - w0) / wf;
  const anchor = [camera[0] + fx * t, camera[1] + fy * t, camera[2] + fz * t];
  const anchorW = m[3] * anchor[0] + m[7] * anchor[1] + m[11] * anchor[2] + m[15];
  return {anchor, pixelScale: anchorW / focalW};
}

function getGlobeRadius(viewport: Viewport): number {
  const p = viewport.projectPosition([0, 0, 0]);
  return Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
}

/**
 * True when the segment from the camera to `p` (common space) enters the globe sphere before `p`.
 * A target exactly on the visible surface is not beyond the horizon.
 */
export function isBeyondHorizon(camera: number[], p: number[], radius: number): boolean {
  const dx = p[0] - camera[0];
  const dy = p[1] - camera[1];
  const dz = p[2] - camera[2];
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (camera[0] * dx + camera[1] * dy + camera[2] * dz);
  const c = camera[0] * camera[0] + camera[1] * camera[1] + camera[2] * camera[2] - radius * radius;
  const disc = b * b - 4 * a * c;
  if (!(disc > 0) || a === 0) {
    return false;
  }
  const s = (-b - Math.sqrt(disc)) / (2 * a);
  // Tolerance: 1e-6 of the segment, so a surface target does not hide itself.
  return s > 0 && s < 1 - 1e-6;
}
