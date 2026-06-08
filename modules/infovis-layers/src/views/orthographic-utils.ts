// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Bounds} from './bounds-utils';

/**
 * Fits two-dimensional bounds into an orthographic viewport using one shared zoom value.
 * @param width - Viewport width in pixels.
 * @param height - Viewport height in pixels.
 * @param bounds - World-space bounds to fit.
 * @param zoomMode - Shared-zoom mode selector.
 * @returns View target and shared/per-axis zoom values.
 */
export function fitBoundsOrthographic(
  width: number,
  height: number,
  bounds: Readonly<Bounds>,
  zoomMode: 'single'
): {target: [number, number]; zoom: number; zoomX: number; zoomY: number};

/**
 * Fits two-dimensional bounds into an orthographic viewport using one zoom per axis.
 * @param width - Viewport width in pixels.
 * @param height - Viewport height in pixels.
 * @param bounds - World-space bounds to fit.
 * @param zoomMode - Per-axis zoom mode selector.
 * @returns View target and per-axis zoom values.
 */
export function fitBoundsOrthographic(
  width: number,
  height: number,
  bounds: Readonly<Bounds>,
  zoomMode: 'per-axis'
): {target: [number, number]; zoom: [number, number]; zoomX: number; zoomY: number};

/**
 * Fits two-dimensional bounds into an orthographic viewport.
 * @param width - Viewport width in pixels.
 * @param height - Viewport height in pixels.
 * @param bounds - World-space bounds to fit.
 * @param zoomMode - Whether to use one shared zoom or one zoom per axis.
 * @returns View target plus deck.gl orthographic zoom values.
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
 * Computes world-space bounds covered by an orthographic viewport.
 * @param width - Viewport width in pixels.
 * @param height - Viewport height in pixels.
 * @param zoom - Deck.gl orthographic zoom level, as one value or `[zoomX, zoomY]`.
 * @param target - Deck.gl orthographic target `[centerX, centerY]`.
 * @returns World-space bounds covered by the viewport.
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
