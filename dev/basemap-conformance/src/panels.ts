// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The diagnostic panels of a comparison image as plain RGBA arrays, so they can be drawn in Node
 * as well as in the browser. Same colors as basemap-layers' `images.ts`.
 */

/** SSIM map: white where the renders agree, dark red where they differ. */
export function ssimPanel(ssimMap: Float32Array, width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const dissimilarity = Math.min(1, Math.max(0, 1 - ssimMap[i]));
    pixels[i * 4] = 255 - dissimilarity * 115;
    pixels[i * 4 + 1] = 255 - dissimilarity * 255;
    pixels[i * 4 + 2] = 255 - dissimilarity * 255;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

/** Edges: magenta only in the reference, green only in the candidate, black in both (within 1 px). */
export function edgePanel(
  referenceEdges: Uint8Array,
  candidateEdges: Uint8Array,
  width: number,
  height: number
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  const near = (edges: Uint8Array, x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < width && yy < height && edges[yy * width + xx]) {
          return true;
        }
      }
    }
    return false;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let color: number[] | null = null;
      if (referenceEdges[i]) {
        color = near(candidateEdges, x, y) ? [0, 0, 0] : [214, 0, 170];
      } else if (candidateEdges[i]) {
        color = near(referenceEdges, x, y) ? [0, 0, 0] : [0, 160, 60];
      }
      if (color) {
        pixels.set([...color, 255], i * 4);
      }
    }
  }
  return pixels;
}
