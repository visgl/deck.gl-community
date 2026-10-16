// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Builds the comparison image of a scene: MapLibre GL JS, `BasemapLayer`, the SSIM map and the
 * edge overlay, side by side, as base64 PNG.
 */
export function createComparisonImage({
  width,
  height,
  reference,
  candidate,
  ssimMap,
  referenceEdges,
  candidateEdges
}: {
  width: number;
  height: number;
  reference: Uint8ClampedArray;
  candidate: Uint8ClampedArray;
  ssimMap: Float32Array;
  referenceEdges: Uint8Array;
  candidateEdges: Uint8Array;
}): string {
  const LABEL_HEIGHT = 18;
  const canvas = document.createElement('canvas');
  canvas.width = width * 4;
  canvas.height = height + LABEL_HEIGHT;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const panel = (pixels: Uint8ClampedArray, index: number) => {
    context.putImageData(
      new ImageData(new Uint8ClampedArray(pixels), width, height),
      width * index,
      LABEL_HEIGHT
    );
  };
  panel(reference, 0);
  panel(candidate, 1);

  // SSIM map: white where the renders agree, dark red where they differ.
  const ssimPixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const dissimilarity = Math.min(1, Math.max(0, 1 - ssimMap[i]));
    ssimPixels[i * 4] = 255 - dissimilarity * 115;
    ssimPixels[i * 4 + 1] = 255 - dissimilarity * 255;
    ssimPixels[i * 4 + 2] = 255 - dissimilarity * 255;
    ssimPixels[i * 4 + 3] = 255;
  }
  panel(ssimPixels, 2);

  // Edges: magenta only in MapLibre, green only in BasemapLayer, black in both (within 1 px).
  const edgePixels = new Uint8ClampedArray(width * height * 4).fill(255);
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
        edgePixels.set([...color, 255], i * 4);
      }
    }
  }
  panel(edgePixels, 3);

  context.fillStyle = '#000000';
  context.font = '12px sans-serif';
  const titles = [
    'MapLibre GL JS',
    'BasemapLayer',
    'SSIM map (red: dissimilar)',
    'Edges (magenta: MapLibre only, green: BasemapLayer only)'
  ];
  titles.forEach((title, index) => {
    context.fillText(title, width * index + 4, 13);
  });
  return canvas.toDataURL('image/png').split(',')[1];
}
