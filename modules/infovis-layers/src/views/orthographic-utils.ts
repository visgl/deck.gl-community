// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Bounds} from './bounds-utils';

export function fitBoundsOrthographic(
  width: number,
  height: number,
  bounds: Readonly<Bounds>,
  zoomMode: 'single'
): {target: [number, number]; zoom: number; zoomX: number; zoomY: number};

export function fitBoundsOrthographic(
  width: number,
  height: number,
  bounds: Readonly<Bounds>,
  zoomMode: 'per-axis'
): {target: [number, number]; zoom: [number, number]; zoomX: number; zoomY: number};

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
  zoomMode: 'single' | 'per-axis' = 'per-axis'
): {
  target: [number, number];
  zoom: number | [number, number];
  zoomX: number;
  zoomY: number;
} {
  const [[minX, minY], [maxX, maxY]] = bounds;

  // center of the box
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  // size of the box
  const boxW = Math.max(0, maxX - minX);
  const boxH = Math.max(0, maxY - minY);

  // scale (world units → screen pixels)
  const scaleX = boxW ? Math.max(1, width) / boxW : 1;
  const scaleY = boxH ? Math.max(1, height) / boxH : 1;

  // pick the smaller scale so the whole box fits
  const scale = Math.min(scaleX, scaleY);

  // deck.gl orthographic zoom is log2(scale)
  const zoom = Math.log2(scale);

  // 3) axis‐specific zooms (deck.gl’s orthographic zoom = log2(scale))
  const zoomX = Math.log2(scaleX);
  const zoomY = Math.log2(scaleY);

  if (Number.isNaN(zoom) || Number.isNaN(zoomX) || Number.isNaN(zoomY)) {
    // eslint-disable-next-line no-console
    console.warn('Invalid zoom values:', {zoom, zoomX, zoomY});
  }

  return {
    target: [centerX, centerY],
    zoom: zoomMode === 'single' ? zoom : [zoomX, zoomY],
    zoomX: zoomMode === 'single' ? zoom : zoomX,
    zoomY: zoomMode === 'single' ? zoom : zoomY
  };
}

/**
 * Compute the `bounds` in world coordinates covered in the viewport.
 * @param width viewport width in px
 * @param height viewport height in px
 * @param zoom deck.gl orthographic zoom level (log2(scale)). Can be a single number or [zoomX, zoomY].
 * @param target deck.gl orthographic target [centerX, centerY]
 * @returns [[minX, minY], [maxX, maxY]] bounds in the same world coordinate units you are rendering
 */
export function getBoundsOrthographic(
  width: number,
  height: number,
  zoom: number | [number, number],
  target: [number, number]
): Bounds {
  const [centerX, centerY] = target;
  const scaleX = Array.isArray(zoom) ? 2 ** zoom[0] : 2 ** zoom;
  const scaleY = Array.isArray(zoom) ? 2 ** zoom[1] : 2 ** zoom;
  const worldW = width / scaleX;
  const worldH = height / scaleY;

  return [
    [centerX - worldW / 2, centerY - worldH / 2],
    [centerX + worldW / 2, centerY + worldH / 2]
  ];
}
