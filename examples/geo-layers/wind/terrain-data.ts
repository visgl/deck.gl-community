// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Smooths an elevation image with two separable three-tap Gaussian passes.
 *
 * The original wind showcase filters the elevation texture and averages adjacent samples
 * in its terrain vertex shader. Pre-filtering once preserves that smooth relief without
 * repeating terrain work while particles animate.
 */
export function smoothWindElevation(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    pixels.length !== width * height * 4
  ) {
    throw new RangeError('Wind elevation pixels must match positive image dimensions.');
  }

  let elevations = Uint8ClampedArray.from(
    {length: width * height},
    (_, index) => pixels[index * 4]
  );

  for (let pass = 0; pass < 2; pass++) {
    const horizontal = new Uint8ClampedArray(elevations.length);
    const smoothed = new Uint8ClampedArray(elevations.length);

    for (let row = 0; row < height; row++) {
      const rowOffset = row * width;
      for (let column = 0; column < width; column++) {
        const index = rowOffset + column;
        const left = elevations[rowOffset + Math.max(0, column - 1)];
        const right = elevations[rowOffset + Math.min(width - 1, column + 1)];
        horizontal[index] = (left + 2 * elevations[index] + right) / 4;
      }
    }

    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const index = row * width + column;
        const above = horizontal[Math.max(0, row - 1) * width + column];
        const below = horizontal[Math.min(height - 1, row + 1) * width + column];
        smoothed[index] = (above + 2 * horizontal[index] + below) / 4;
      }
    }

    elevations = smoothed;
  }

  return elevations;
}
