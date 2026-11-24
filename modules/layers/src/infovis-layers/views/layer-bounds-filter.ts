// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {FilterContext, Layer, Viewport} from '@deck.gl/core';

/** Deck.gl layer filter callback or `null` when no filter should be applied. */
export type LayerFilter = ((context: FilterContext) => boolean) | null;

/** Flat two-dimensional bounds represented as `[minX, minY, maxX, maxY]`. */
export type Bounds = [number, number, number, number];

/** Reason emitted when the viewport bounds filter makes or skips a filter decision. */
export type LayerBoundsFilterDecision =
  | {
      /** Indicates that the layer was filtered because it missed the viewport. */
      decision: 'filter';
      /** Deck.gl filter context evaluated by the filter. */
      context: FilterContext;
      /** Layer bounds evaluated by the filter. */
      layerBounds: Bounds;
      /** Viewport bounds evaluated by the filter. */
      viewportBounds: Bounds;
    }
  | {
      /** Indicates that the layer did not expose usable bounds. */
      decision: 'missing-layer-bounds';
      /** Deck.gl filter context evaluated by the filter. */
      context: FilterContext;
    }
  | {
      /** Indicates that the viewport did not expose usable bounds. */
      decision: 'missing-viewport-bounds';
      /** Deck.gl filter context evaluated by the filter. */
      context: FilterContext;
      /** Layer bounds evaluated before viewport bounds were found missing. */
      layerBounds: Bounds;
    };

/** Configuration for {@link createViewportBoundsFilter}. */
export type LayerBoundsFilterOptions = {
  /** Callback invoked when the filter skips or applies a bounds decision. */
  onDecision?: (decision: LayerBoundsFilterDecision) => void;
};

type BoundsCache<Id extends WeakKey> = WeakMap<Id, Bounds | null>;

/**
 * Combine multiple layer filters.
 * Returns null when none of the supplied filters are defined.
 * @param filters - Layer filters to evaluate in order.
 * @returns One filter that requires every defined filter to pass, or `null`.
 */
export function combineLayerFilters(filters: (LayerFilter | undefined | null)[]): LayerFilter {
  const definedFilters = filters.filter(Boolean) as ((context: FilterContext) => boolean)[];
  if (!definedFilters.length) {
    return null;
  }
  if (definedFilters.length === 1) {
    return definedFilters[0]!;
  }
  return context => definedFilters.every(filter => filter(context));
}

/**
 * Creates a layer filter that compares layer and viewport bounds.
 * Layers that do not intersect the viewport bounds are filtered out.
 * @param options - Optional decision callback configuration.
 * @returns Layer filter that keeps only layers intersecting the current viewport.
 */
export function createViewportBoundsFilter(options?: LayerBoundsFilterOptions): LayerFilter {
  const layerBoundsCache: BoundsCache<Layer> = new WeakMap();
  const viewportBoundsCache: BoundsCache<Viewport> = new WeakMap();

  return (context: FilterContext) => {
    const {layer, viewport} = context;

    let layerBounds = layerBoundsCache.get(layer);
    if (layerBounds === undefined) {
      layerBounds = getLayerBounds(layer);
      layerBoundsCache.set(layer, layerBounds);
    }
    if (!layerBounds) {
      options?.onDecision?.({decision: 'missing-layer-bounds', context});
      return true;
    }

    let viewportBounds = viewportBoundsCache.get(viewport);
    if (viewportBounds === undefined) {
      viewportBounds = getViewportBounds(viewport);
      viewportBoundsCache.set(viewport, viewportBounds);
    }
    if (!viewportBounds) {
      options?.onDecision?.({decision: 'missing-viewport-bounds', context, layerBounds});
      return true;
    }

    const shouldRender = boundsOverlap(layerBounds, viewportBounds);
    if (!shouldRender) {
      options?.onDecision?.({decision: 'filter', context, layerBounds, viewportBounds});
    }
    return shouldRender;
  };
}

function getLayerBounds(layer: Layer): Bounds | null {
  const bounds = layer.getBounds();
  if (!bounds || bounds.length < 2) {
    return null;
  }
  return normalizeBounds(bounds[0], bounds[1]);
}

function getViewportBounds(viewport: Viewport): Bounds | null {
  const bounds = viewport.getBounds();
  if (!bounds || bounds.length < 4) {
    return null;
  }

  const [minX, minY, maxX, maxY] = bounds;
  if (
    !isFiniteNumber(minX) ||
    !isFiniteNumber(minY) ||
    !isFiniteNumber(maxX) ||
    !isFiniteNumber(maxY)
  ) {
    return null;
  }
  return normalizeBounds([minX, minY], [maxX, maxY]);
}

function normalizeBounds(min: number[] | undefined, max: number[] | undefined): Bounds | null {
  if (!min || !max || min.length < 2 || max.length < 2) {
    return null;
  }

  const minX = Math.min(min[0]!, max[0]!);
  const minY = Math.min(min[1]!, max[1]!);
  const maxX = Math.max(min[0]!, max[0]!);
  const maxY = Math.max(min[1]!, max[1]!);

  if (
    !isFiniteNumber(minX) ||
    !isFiniteNumber(minY) ||
    !isFiniteNumber(maxX) ||
    !isFiniteNumber(maxY)
  ) {
    return null;
  }

  return [minX, minY, maxX, maxY];
}

function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}
