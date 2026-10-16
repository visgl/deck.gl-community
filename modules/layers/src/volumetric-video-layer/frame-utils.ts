// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** The contiguous presentation-frame window retained for drawing. */
export type FrameWindow = {
  /** Index of the oldest frame in the retained window. */
  firstFrame: number;
  /** Index of the selected, newest frame in the retained window. */
  currentFrame: number;
  /** Number of retained frames, including the selected frame. */
  frameCount: number;
};

/** A trail counts preceding frames; the selected frame is always included. */
export function getFrameWindow(
  currentFrame: number,
  frameTrail: number,
  totalFrames: number,
  capacity: number
): FrameWindow {
  const last = Math.max(0, Math.min(totalFrames - 1, toInteger(currentFrame)));
  const count = Math.min(last + 1, Math.max(1, capacity), toInteger(frameTrail) + 1);
  return {firstFrame: last - count + 1, currentFrame: last, frameCount: totalFrames ? count : 0};
}

/** Automatically sizes history to the requested trail, or honors an explicit reservation.
 * The source length is the only software limit; device limits are checked before allocation.
 */
export function getFrameCapacity(
  frameTrail: number,
  maxFrameTrail: number | null,
  totalFrames: number
): number {
  return Math.max(1, Math.min(toInteger(totalFrames), toInteger(maxFrameTrail ?? frameTrail) + 1));
}

/** Fits an aspect-preserving sampling grid within a maximum dimension. */
export function getFrameSize(width: number, height: number, resolution: number) {
  const scale =
    resolution === 0
      ? 1
      : Math.min(1, Math.max(1, toInteger(resolution)) / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function toInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** Returns bytes for raw RGBA, per-pixel changes, and the filtered RGBA mip pyramid.
 * Includes every mip level in each of `capacity` retained frames; excludes upload/decoder memory.
 */
export function getFrameHistoryBytes(width: number, height: number, capacity: number): number {
  if (![width, height, capacity].every(Number.isFinite)) {
    throw new RangeError('Frame dimensions and history capacity must be finite.');
  }
  const baseWidth = Math.max(1, Math.round(width));
  const baseHeight = Math.max(1, Math.round(height));
  let filteredBytes = 0;
  let w = baseWidth;
  let h = baseHeight;
  while (true) {
    filteredBytes += w * h * 4;
    if (w === 1 && h === 1) break;
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
  }
  return (baseWidth * baseHeight * 8 + filteredBytes) * Math.max(0, Math.floor(capacity));
}
