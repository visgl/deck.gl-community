// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Bounds} from './bounds-utils';
import type {OrthographicViewState} from '@deck.gl/core';

/** Default floating-point tolerance used when comparing bounds values. @defaultValue 1e-6 */
export const DEFAULT_BOUNDS_EPSILON = 1e-6;

/**
 * Axis-aligned bounding box describing the area that is currently visible in a Deck.gl viewport.
 *
 */
export type ViewportBounds = {
  /** Inclusive minimum world-space X coordinate within the viewport. */
  minX: number;
  /** Inclusive maximum world-space X coordinate within the viewport. */
  maxX: number;
  /** Inclusive minimum world-space Y coordinate within the viewport. */
  minY: number;
  /** Inclusive maximum world-space Y coordinate within the viewport. */
  maxY: number;
};

/** Floating-point comparison configuration for {@link boundsAreEqual}. */
export type BoundsEqualityOptions = {
  /** Maximum allowed coordinate delta before bounds differ. @defaultValue DEFAULT_BOUNDS_EPSILON */
  epsilon?: number;
};

/**
 * Returns `true` when two bounds tuples are identical within a configurable floating-point
 * tolerance.
 *
 * @param a - First bounds tuple to compare.
 * @param b - Second bounds tuple to compare.
 * @param options - Comparison configuration.
 * @param options.epsilon - Maximum allowed absolute difference between coordinate values before
 * the bounds are considered distinct. Defaults to {@link DEFAULT_BOUNDS_EPSILON}.
 */
export function boundsAreEqual(a: Bounds, b: Bounds, options?: BoundsEqualityOptions): boolean {
  const epsilon = options?.epsilon ?? DEFAULT_BOUNDS_EPSILON;
  let [ax, ay] = a[0];
  let [bx, by] = b[0];
  if (Math.abs(ax - bx) > epsilon || Math.abs(ay - by) > epsilon) {
    return false;
  }
  [ax, ay] = a[1];
  [bx, by] = b[1];
  if (Math.abs(ax - bx) > epsilon || Math.abs(ay - by) > epsilon) {
    return false;
  }
  return true;
}

/**
 * Computes the world-space bounds of an orthographic viewport given its view state and Deck.gl
 * dimensions.
 *
 * @param view - The orthographic view state describing the viewport target and zoom level.
 * @param deckDimensions - The pixel dimensions of the Deck.gl canvas hosting the view.
 * @returns The minimum and maximum X/Y world-space coordinates visible within the viewport.
 */
export function getViewportBoundsForViewState(
  view: OrthographicViewState,
  deckDimensions: {width: number; height: number}
): ViewportBounds {
  const target = view.target ?? [0, 0];
  const zoomValue = view.zoom;
  const zoomArray = Array.isArray(zoomValue)
    ? zoomValue
    : typeof zoomValue === 'number'
      ? [zoomValue, zoomValue]
      : [0, 0];

  const zoomX = zoomArray[0] ?? 0;
  const zoomY = zoomArray[1] ?? zoomArray[0] ?? 0;
  const scaleX = 2 ** zoomX || 1;
  const scaleY = 2 ** zoomY || 1;
  const halfWidth = deckDimensions.width / scaleX / 2;
  const halfHeight = deckDimensions.height / scaleY / 2;

  return {
    minX: target[0] - halfWidth,
    maxX: target[0] + halfWidth,
    minY: target[1] - halfHeight,
    maxY: target[1] + halfHeight
  } satisfies ViewportBounds;
}

/**
 * Determines whether a bounds tuple lies entirely outside the supplied viewport bounds.
 *
 * @param bounds - The bounds tuple that may or may not intersect with the viewport.
 * @param viewport - The viewport bounds to test against.
 * @returns `true` when the bounds are completely outside of the viewport; otherwise `false`.
 */
export function isBoundsCompletelyOutside(bounds: Bounds, viewport: ViewportBounds): boolean {
  const [[minX, minY], [maxX, maxY]] = bounds;
  return (
    maxX < viewport.minX || minX > viewport.maxX || maxY < viewport.minY || minY > viewport.maxY
  );
}
