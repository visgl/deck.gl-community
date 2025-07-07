// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

type Bounds = [[number, number], [number, number]];

export function fitBoundsOrthographic(
  width: number,
  height: number,
  bounds: Readonly<Bounds>,
  zoomMode: 'single',
): { target: [number, number]; zoom: number };

export function fitBoundsOrthographic(
  width: number,
  height: number,
  bounds: Readonly<Bounds>,
  zoomMode: 'per-axis',
): { target: [number, number]; zoom: [number, number] };

/**
 * Compute center & zoom for an OrthographicViewport so that `bounds` fills the viewport.
 * @param width  viewport width in px
 * @param height viewport height in px
 * @param bounds [[minX,minY],[maxX,maxY]] in the same world units you’re rendering
 * @returns { target: [number, number], zoom: number }
 *   target: center of the viewport in world units
 *   zoom: deck.gl orthographic zoom level (log2(scale))
 *   (deck.gl orthographic zoom is the log2 of the scale factor)
 */
export function fitBoundsOrthographic(
  width: number,
  height: number,
  bounds: Readonly<Bounds>,
  zoomMode: 'single' | 'per-axis' = 'per-axis',
): { target: [number, number]; zoom: number | [number, number] } {
  const [[minX, minY], [maxX, maxY]] = bounds;

  // center of the box
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  // size of the box
  const boxW = maxX - minX;
  const boxH = maxY - minY;

  // scale (world units → screen pixels)
  const scaleX = width / boxW;
  const scaleY = height / boxH;

  // pick the smaller scale so the whole box fits
  const scale = Math.min(scaleX, scaleY);

  // deck.gl orthographic zoom is log2(scale)
  const zoom = Math.log2(scale);

  // 3) axis‐specific zooms (deck.gl’s orthographic zoom = log2(scale))
  const zoomX = Math.log2(scaleX);
  const zoomY = Math.log2(scaleY);

  if (Number.isNaN(zoom) || Number.isNaN(zoomX) || Number.isNaN(zoom)) {
    console.warn('Invalid zoom values:', { zoom, zoomX, zoomY });
  }

  return {
    target: [centerX, centerY],
    zoom: zoomMode === 'single' ? zoom : [zoomX, zoomY],
  };
}
