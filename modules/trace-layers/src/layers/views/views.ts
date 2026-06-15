import {OrthographicView} from '@deck.gl/core';
import {Bounds, fitBoundsOrthographic} from '@deck.gl-community/infovis-layers';

import {ViewLayoutItem} from '@deck.gl-community/infovis-layers';
import {TraceOrthographicController} from './trace-orthographic-controller';

import type {TraceDragInteractionMode} from './trace-orthographic-controller';
import type {OrthographicViewState} from '@deck.gl/core';

type Geometry = ArrayLike<number> | null | undefined;

/** Tracevis view-layout options independent of the current deck canvas size. */
export type TracevisViewLayoutOptions = {
  /** Fixed header height in pixels. */
  headerViewHeight?: number;
  /** Fixed legend column width in pixels. */
  legendViewWidth?: number;
  /** Whether the main timeline should use the full width while legend labels render as an overlay. */
  collapseLegendToProcessLabelOverlay?: boolean;
  /** Height in pixels reserved for the fixed run-event strip below the header. */
  runEventViewHeight?: number;
  /** Whether to reserve and render the overview minimap view. */
  minimap?: boolean;
  /** Fixed minimap height in pixels. */
  minimapViewHeight?: number;
  /** Trackpad swipe behavior used for timeline navigation. */
  traceDragInteractionMode?: TraceDragInteractionMode;
};

const MAIN_VIEW_CONTROLLER = {
  type: TraceOrthographicController,
  zoomAxis: 'X',
  keyboard: false,
  scrollZoom: {
    // TODO - sadly there is a bug in smooth zooming when rendering falls below nominal frame rate. Re-enable when fixed.
    // smooth: true,
  },
  inertia: true
};

/**
 * Builds the tracevis-specific synchronized deck view layout.
 *
 * @param args - Tracevis view dimensions, optional minimap/run-event strips, and interaction mode.
 * @returns Declarative view-layout tree preserving legacy tracevis view ids and overlay semantics.
 */
export function buildTracevisViewLayout({
  headerViewHeight = 36,
  legendViewWidth = 150,
  collapseLegendToProcessLabelOverlay = false,
  runEventViewHeight = 0,
  minimap = false,
  minimapViewHeight = 150,
  traceDragInteractionMode = 'drag-to-zoom'
}: TracevisViewLayoutOptions): ViewLayoutItem {
  const minimapH = minimap ? minimapViewHeight : 0;
  const runEventH = Math.max(0, runEventViewHeight);
  const mainTopInset = headerViewHeight + runEventH;
  const reservedLegendViewWidth = collapseLegendToProcessLabelOverlay ? 0 : legendViewWidth;
  const mainViewController = {
    ...MAIN_VIEW_CONTROLLER,
    traceDragInteractionMode
  };
  const minimapViewController = {
    ...MAIN_VIEW_CONTROLLER,
    scrollZoom: false,
    traceDragInteractionMode: 'drag-to-zoom'
  };
  return new ViewLayoutItem({
    type: 'overlay',
    children: [
      new OrthographicView({
        id: 'interaction-capture',
        flipY: true,
        clear: false,
        x: 0,
        y: 0,
        width: '100%',
        height: minimap ? `calc(100% - ${minimapH}px)` : '100%',
        padding: {left: reservedLegendViewWidth, top: mainTopInset},
        controller: mainViewController,
        viewState: {id: 'main'}
      }),
      reservedLegendViewWidth > 0
        ? new OrthographicView({
            id: 'legend-background',
            flipY: true,
            clear: false,
            x: 0,
            y: mainTopInset,
            width: reservedLegendViewWidth,
            height: `calc(100% - ${mainTopInset + minimapH}px)`,
            controller: false,
            viewState: {
              id: 'main',
              target: [0, Number.NaN],
              zoomX: 12
            }
          })
        : null,
      new OrthographicView({
        id: 'main',
        flipY: true,
        clear: true,
        x: reservedLegendViewWidth,
        y: mainTopInset,
        width: `calc(100% - ${reservedLegendViewWidth}px)`,
        height: `calc(100% - ${mainTopInset + minimapH}px)`,
        controller: mainViewController
      }),
      new OrthographicView({
        id: 'header',
        flipY: true,
        clear: false,
        x: reservedLegendViewWidth,
        y: 0,
        width: `calc(100% - ${reservedLegendViewWidth}px)`,
        height: '100%',
        controller: false,
        padding: {top: headerViewHeight, bottom: `calc(100% - ${headerViewHeight}px)`},
        viewState: {
          id: 'main',
          target: [Number.NaN, 0],
          zoomY: 0
        }
      }),
      runEventH > 0
        ? new OrthographicView({
            id: 'run-events',
            flipY: true,
            clear: false,
            x: reservedLegendViewWidth,
            y: headerViewHeight,
            width: `calc(100% - ${reservedLegendViewWidth}px)`,
            height: runEventH,
            controller: false,
            viewState: {
              id: 'main',
              target: [Number.NaN, 0],
              zoomY: 0
            }
          })
        : null,
      runEventH > 0
        ? new OrthographicView({
            id: 'run-events-legend',
            flipY: true,
            clear: false,
            x: 0,
            y: headerViewHeight,
            width: '100%',
            height: runEventH,
            controller: false,
            padding: {left: legendViewWidth, right: `calc(100% - ${legendViewWidth}px)`},
            viewState: {
              id: 'main',
              target: [0, 0],
              zoomX: 12,
              zoomY: 0
            }
          })
        : null,
      new OrthographicView({
        id: 'legend',
        flipY: true,
        clear: false,
        x: 0,
        y: mainTopInset,
        width: '100%',
        height: `calc(100% - ${mainTopInset + minimapH}px)`,
        controller: false,
        padding: {left: legendViewWidth, right: `calc(100% - ${legendViewWidth}px)`},
        viewState: {
          id: 'main',
          target: [0, Number.NaN],
          // zoomX is an arbitrary large number so that it is larger than zoomY
          // This is a hack around deck.gl's 2D zoom handling - the smaller of the two zooms is used to project common size
          zoomX: 12
        }
      }),
      minimap
        ? new OrthographicView({
            id: 'minimap',
            flipY: true,
            clear: true,
            x: 0,
            y: `calc(100% - ${minimapH}px)`,
            width: '100%',
            height: minimapH,
            controller: minimapViewController
          })
        : null
    ]
  });
}

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
  options?: {
    paddingFraction?: number;
    minimumPadding?: number;
  }
): Bounds | null {
  const bounds = getGeometryBounds(geometry);
  if (!bounds) {
    return null;
  }

  const paddingFraction = options?.paddingFraction ?? 0.1;
  const minimumPadding = options?.minimumPadding ?? 1;
  return padBounds(bounds, paddingFraction, minimumPadding);
}

export function fitViewStateToBounds(props: {
  viewState: OrthographicViewState;
  width: number;
  height: number;
  bounds: [[xMin: number, yMin: number], [xMax: number, yMax: number]];
  /** App should set to true on first call */
  initialize: boolean;
}): OrthographicViewState {
  const {viewState, initialize} = props;

  // Handle cases where the window size is too small for the header and/or legend
  const width = Math.max(props.width, 1);
  const height = Math.max(props.height, 1);

  const nextViewState = fitBoundsOrthographic(width, height, props.bounds, 'per-axis');
  let {zoomX, zoomY} = nextViewState;
  if (viewState.maxZoomX !== undefined) {
    zoomX = Math.min(zoomX, viewState.maxZoomX);
  }
  if (viewState.maxZoomY !== undefined) {
    zoomY = Math.min(zoomY, viewState.maxZoomY);
  }
  if (viewState.minZoomX !== undefined) {
    zoomX = Math.max(zoomX, viewState.minZoomX);
  }
  if (viewState.minZoomY !== undefined) {
    zoomY = Math.max(zoomY, viewState.minZoomY);
  }

  let newViewState: OrthographicViewState;
  // Avoid messing with y axis if we have already fitted the view state
  if (initialize) {
    newViewState = {...viewState, target: nextViewState.target, zoomX, zoomY};
  } else {
    newViewState = {
      ...viewState,
      target: nextViewState.target,
      zoomX
    };
  }
  return newViewState;
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
