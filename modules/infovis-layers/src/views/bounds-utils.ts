// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Two-dimensional world-space bounds represented by minimum and maximum corners. */
export type Bounds = [[number, number], [number, number]];
/** Interleaved X/Y block geometry values accepted by {@link getPaddedBlockBounds}. */
export type Geometry = ArrayLike<number> | null | undefined;

/** Padding configuration for {@link getPaddedBlockBounds}. */
export type PaddedBlockBoundsOptions = {
  /** Padding added as a fraction of geometry width and height. @defaultValue 0.1 */
  paddingFraction?: number;
  /** Minimum world-space padding added on each axis. @defaultValue 1 */
  minimumPadding?: number;
};

/**
 * Computes padded bounds for a block geometry represented as an interleaved array of X/Y
 * coordinates.
 *
 * @param geometry - The geometry describing the block perimeter, or `null`/`undefined` when the
 * block has not been rendered.
 * @param options - Optional padding configuration. When omitted, a small percentage padding is
 * applied so that the block does not touch the viewport edges.
 * @returns The padded bounds for the geometry or `null` if the input does not contain any points.
 */
export function getPaddedBlockBounds(
  geometry: Geometry,
  options?: PaddedBlockBoundsOptions
): Bounds | null {
  const bounds = getGeometryBounds(geometry);
  if (!bounds) {
    return null;
  }

  const paddingFraction = options?.paddingFraction ?? 0.1;
  const minimumPadding = options?.minimumPadding ?? 1;
  return padBounds(bounds, paddingFraction, minimumPadding);
}

function getGeometryBounds(geometry: Geometry): Bounds | null {
  if (!geometry || geometry.length < 2) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let index = 0; index < geometry.length; index += 2) {
    const x = geometry[index]!;
    const y = geometry[index + 1]!;

    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }

  return [
    [minX, minY],
    [maxX, maxY]
  ];
}

function padBounds(bounds: Bounds, paddingFraction: number, minimumPadding: number): Bounds {
  const [[minX, minY], [maxX, maxY]] = bounds;
  const width = maxX - minX;
  const height = maxY - minY;
  const paddingX = Math.max(width * paddingFraction, minimumPadding);
  const paddingY = Math.max(height * paddingFraction, minimumPadding);

  return [
    [minX - paddingX, minY - paddingY],
    [maxX + paddingX, maxY + paddingY]
  ];
}
