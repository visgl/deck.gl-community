import {LinearInterpolator} from '@deck.gl/core';
import {
  Bounds,
  fitBoundsOrthographic,
  getPaddedBlockBounds
} from '@deck.gl-community/infovis-layers';

import type {SpanBoundingBox} from '../../trace/index';
import type {OrthographicViewState} from '@deck.gl/core';

const DEFAULT_ORIGIN_Y = 0;
const DEFAULT_ZOOM_Y = 5;
const INTERPOLATOR_INSTANCE = new LinearInterpolator(['target', 'zoomX', 'zoomY']);
const MIN_BLOCK_VIEWPORT_FRACTION = 0.1;
const MIN_BLOCK_PIXEL_WIDTH = 50;
const FIT_VIEW_HORIZONTAL_MARGIN_PX = 75;
const FIT_VIEW_TOP_MARGIN_PX = 50;
const BLOCK_NAVIGATION_SCREEN_X_FRACTION = 0.3;
const BLOCK_NAVIGATION_SCREEN_Y_FRACTION = 0.3;
const BLOCK_NAVIGATION_TRANSITION_DURATION_MS = 1200;
const TRACKED_TIME_VIEWPORT_FRACTION = 0.75;
const DEFAULT_TRANSITION = {
  transitionDuration: 600,
  transitionInterpolator: INTERPOLATOR_INSTANCE,
  transitionEasing: (t: number) => t * t * (3 - 2 * t)
};

/** Options used when applying an imperative trace graph view-state update. */
export type DeckTraceGraphViewUpdateOptions = {
  /** Whether the view update should animate with the default transition. */
  transition?: boolean;
  /** Optional transition duration in milliseconds when `transition` is enabled. */
  transitionDurationMs?: number;
};

/**
 * Expands bounds so the block occupies a minimum fraction or pixel width of the viewport.
 *
 * @param bounds - The block bounds in trace coordinates.
 * @param deckDimensions - Current deck dimensions, used to translate viewport requirements.
 * @param minimumFraction - Minimum fraction of the viewport width the block should cover.
 * @param minPixelWidth - Minimum pixel width the block should cover.
 * @returns Bounds widened around the block center to satisfy the minimum size constraints.
 */
export function widenBoundsForMinimumBlockWidth(
  bounds: Bounds,
  deckDimensions: {width: number; height: number} | null | undefined,
  minimumFraction: number,
  minPixelWidth: number
): Bounds {
  const viewportWidth = Math.max(deckDimensions?.width ?? 1, 1);

  const [[minX, minY], [maxX, maxY]] = bounds;
  const blockWidth = maxX - minX;

  if (!Number.isFinite(blockWidth) || blockWidth <= 0) {
    return bounds;
  }

  const desiredFraction = Math.min(Math.max(minimumFraction, minPixelWidth / viewportWidth), 0.9);
  const targetWidth = blockWidth / desiredFraction;
  const halfWidth = targetWidth / 2;
  const centerX = (minX + maxX) / 2;

  return [
    [centerX - halfWidth, minY],
    [centerX + halfWidth, maxY]
  ];
}

export class DeckTraceGraphController {
  private readonly getViewState: () => OrthographicViewState;
  width: number = 0;
  height: number = 0;

  constructor(getViewState: () => OrthographicViewState) {
    this.getViewState = getViewState;
  }

  clearTransition(): OrthographicViewState {
    return {
      ...this.getViewState(),
      transitionDuration: 0,
      transitionInterpolator: undefined
    };
  }

  fitToBounds(bounds: Bounds, transition: boolean): OrthographicViewState | null {
    if (!this.width || !this.height) {
      return null;
    }
    const nextViewState = fitBoundsOrthographic(
      getFitViewportWidth(this.width),
      this.height,
      bounds,
      'per-axis'
    );
    const {target} = nextViewState;
    let {zoomX, zoomY} = nextViewState;
    const viewState = this.getViewState();
    if (viewState.maxZoomX !== undefined) {
      zoomX = Math.min(zoomX, viewState.maxZoomX);
    }
    if (viewState.minZoomX !== undefined) {
      zoomX = Math.max(zoomX, viewState.minZoomX);
    }
    zoomY = DEFAULT_ZOOM_Y;
    // Align [0,0] to top
    const yScale = 2 ** zoomY;
    target[1] = (this.height / 2 - DEFAULT_ORIGIN_Y - FIT_VIEW_TOP_MARGIN_PX) / yScale;

    return {
      ...viewState,
      target,
      zoomX,
      zoomY,
      ...(transition ? DEFAULT_TRANSITION : null)
    };
  }

  /**
   * Fits both timeline axes to the provided bounds.
   *
   * @param bounds - Full graph bounds that should be visible in the viewport.
   * @param transition - Whether to animate the view-state update.
   * @returns The next orthographic view state, or null when dimensions are unavailable.
   */
  fitEntireBounds(bounds: Bounds, transition: boolean): OrthographicViewState | null {
    if (!this.width || !this.height) {
      return null;
    }
    const nextViewState = fitBoundsOrthographic(
      getFitViewportWidth(this.width),
      this.height,
      bounds,
      'per-axis'
    );
    const {target} = nextViewState;
    let {zoomX, zoomY} = nextViewState;
    const viewState = this.getViewState();
    if (viewState.maxZoomX !== undefined) {
      zoomX = Math.min(zoomX, viewState.maxZoomX);
    }
    if (viewState.minZoomX !== undefined) {
      zoomX = Math.max(zoomX, viewState.minZoomX);
    }
    if (viewState.maxZoomY !== undefined) {
      zoomY = Math.min(zoomY, viewState.maxZoomY);
    }
    if (viewState.minZoomY !== undefined) {
      zoomY = Math.max(zoomY, viewState.minZoomY);
    }

    return {
      ...viewState,
      target: [target[0], target[1], viewState.target?.[2] ?? 0],
      zoomX,
      zoomY,
      ...(transition ? DEFAULT_TRANSITION : null)
    };
  }

  zoomToSpan(geometry: SpanBoundingBox): OrthographicViewState | null {
    if (!this.width || !this.height) {
      return null;
    }
    const bounds = getPaddedBlockBounds(geometry);
    if (!bounds) {
      return null;
    }

    const targetBounds = widenBoundsForMinimumBlockWidth(
      bounds,
      this,
      MIN_BLOCK_VIEWPORT_FRACTION,
      MIN_BLOCK_PIXEL_WIDTH
    );

    return this.fitToBounds(targetBounds, true);
  }

  panTo(
    target: [number, number],
    options?: DeckTraceGraphViewUpdateOptions
  ): OrthographicViewState {
    const viewState = this.getViewState();
    return {
      ...viewState,
      target: [target[0], target[1], viewState.target?.[2] ?? 0],
      ...getViewUpdateTransition(options)
    };
  }

  panBy(
    delta: [x: number, y: number],
    options?: DeckTraceGraphViewUpdateOptions
  ): OrthographicViewState {
    const {target, zoomX, zoomY} = this.getViewState();
    return this.panTo(
      [(target?.[0] ?? 0) + delta[0] / 2 ** zoomX!, (target?.[1] ?? 0) + delta[1] / 2 ** zoomY!],
      options
    );
  }

  zoomXBy(delta: number, options?: DeckTraceGraphViewUpdateOptions): OrthographicViewState {
    const viewState = this.getViewState();
    let nextZoomX = viewState.zoomX! + delta;
    if (viewState.maxZoomX !== undefined) {
      nextZoomX = Math.min(nextZoomX, viewState.maxZoomX);
    }
    if (viewState.minZoomX !== undefined) {
      nextZoomX = Math.max(nextZoomX, viewState.minZoomX);
    }
    return {
      ...viewState,
      zoomX: nextZoomX,
      ...getViewUpdateTransition(options)
    };
  }

  centerOnSpan(geometry: SpanBoundingBox): OrthographicViewState | null {
    const bounds = getPaddedBlockBounds(geometry);
    if (!bounds) {
      return null;
    }

    const centerX = (bounds[0][0] + bounds[1][0]) / 2;
    const centerY = (bounds[0][1] + bounds[1][1]) / 2;
    const {zoomX, zoomY} = this.getViewState();
    const xScale = zoomX == null ? NaN : 2 ** zoomX;
    const yScale = zoomY == null ? NaN : 2 ** zoomY;
    const targetX =
      this.width > 0 && Number.isFinite(xScale) && xScale > 0
        ? centerX + (this.width * (0.5 - BLOCK_NAVIGATION_SCREEN_X_FRACTION)) / xScale
        : centerX;
    const targetY =
      this.height > 0 && Number.isFinite(yScale) && yScale > 0
        ? centerY + (this.height * (0.5 - BLOCK_NAVIGATION_SCREEN_Y_FRACTION)) / yScale
        : centerY;

    return this.panTo([targetX, targetY], {
      transition: true,
      transitionDurationMs: BLOCK_NAVIGATION_TRANSITION_DURATION_MS
    });
  }

  /**
   * Tracks a trace time at the preferred horizontal screen anchor while fitting graph vertical bounds.
   *
   * @param timeMs - Absolute trace time to place at the tracking anchor.
   * @param bounds - Full graph bounds used for the vertical fit.
   * @returns The next orthographic view state, or null when dimensions are unavailable.
   */
  centerOnTimeAndFitY(timeMs: number, bounds: Bounds): OrthographicViewState | null {
    const trackedViewState = this.trackTime(timeMs);
    if (!trackedViewState) {
      return null;
    }
    return this.fitYToBounds(bounds, trackedViewState);
  }

  /**
   * Tracks a trace time at the preferred horizontal screen anchor while preserving vertical state.
   *
   * @param timeMs - Absolute trace time to place at the tracking anchor.
   * @returns The next orthographic view state, or null when the input cannot be tracked.
   */
  trackTime(timeMs: number): OrthographicViewState | null {
    if (!this.width || !Number.isFinite(timeMs)) {
      return null;
    }
    const viewState = this.getViewState();
    const zoomX = viewState.zoomX ?? 0;
    const xScale = 2 ** zoomX;
    const targetX =
      Number.isFinite(xScale) && xScale > 0
        ? timeMs - ((TRACKED_TIME_VIEWPORT_FRACTION - 0.5) * this.width) / xScale
        : timeMs;

    return {
      ...viewState,
      target: [targetX, viewState.target?.[1] ?? 0, viewState.target?.[2] ?? 0],
      transitionDuration: 0,
      transitionInterpolator: undefined
    };
  }

  /**
   * Fits the viewport to the provided vertical bounds while preserving horizontal state.
   *
   * @param bounds - Full graph bounds used to compute the vertical fit.
   * @param baseViewState - Optional view state whose horizontal target and zoom should be preserved.
   * @returns The next orthographic view state, or null when dimensions are unavailable.
   */
  fitYToBounds(
    bounds: Bounds,
    baseViewState: OrthographicViewState = this.getViewState()
  ): OrthographicViewState | null {
    if (!this.width || !this.height) {
      return null;
    }
    const fitViewState = fitBoundsOrthographic(this.width, this.height, bounds, 'per-axis');
    let zoomY = fitViewState.zoomY;
    if (baseViewState.maxZoomY !== undefined) {
      zoomY = Math.min(zoomY, baseViewState.maxZoomY);
    }
    if (baseViewState.minZoomY !== undefined) {
      zoomY = Math.max(zoomY, baseViewState.minZoomY);
    }

    return {
      ...baseViewState,
      target: [
        baseViewState.target?.[0] ?? 0,
        fitViewState.target[1],
        baseViewState.target?.[2] ?? 0
      ],
      zoomY,
      transitionDuration: 0,
      transitionInterpolator: undefined
    };
  }
}

/**
 * Returns the viewport width used for fit calculations, leaving a small visible horizontal margin.
 */
function getFitViewportWidth(width: number): number {
  return Math.max(1, width - FIT_VIEW_HORIZONTAL_MARGIN_PX * 2);
}

function getViewUpdateTransition(
  options: DeckTraceGraphViewUpdateOptions | undefined
): Partial<OrthographicViewState> | null {
  if (!options?.transition) {
    return null;
  }
  const transitionDuration = options.transitionDurationMs ?? DEFAULT_TRANSITION.transitionDuration;
  return {
    ...DEFAULT_TRANSITION,
    transitionDuration
  };
}
