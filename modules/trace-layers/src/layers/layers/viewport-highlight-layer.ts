import {CompositeLayer, _deepEqual as deepEqual, UpdateParameters, Viewport} from '@deck.gl/core';
import {PathLayer, PolygonLayer} from '@deck.gl/layers';

import type {CompositeLayerProps, Layer, LayerProps} from '@deck.gl/core';
import type {Bounds} from '@deck.gl-community/infovis-layers';

type ViewportHighlightColor = readonly [number, number, number, number];

type ViewportHighlightHiddenInterval = {
  /** Full-height polygon shading one hidden temporal interval. */
  readonly polygon: readonly [number, number][];
};

type ViewportHighlightBoundaryLine = {
  /** Full-height vertical line marking one edge of the visible temporal window. */
  readonly path: [number, number][];
};

export type ViewportHighlightOverlayData = {
  /** Polygons that shade timeline ranges outside the visible main viewport. */
  readonly hiddenIntervals: readonly ViewportHighlightHiddenInterval[];
  /** Vertical lines at visible main viewport boundaries that fall inside the minimap bounds. */
  readonly boundaryLines: readonly ViewportHighlightBoundaryLine[];
};

export type ViewportHighlightLayerProps = LayerProps &
  CompositeLayerProps & {
    /** View IDs whose X bounds should be projected into the minimap overlay. */
    readonly highlightedViewportIds: readonly string[];
    /** Minimap bounds used for the overlay's X clamps and full-height Y extent. */
    readonly bounds: Bounds;
    /** Optional X offset applied before clamping viewport bounds into minimap coordinates. */
    readonly xOffset?: number;
    /** Fill color used to shade timeline ranges outside the visible main viewport. */
    readonly getFillColor?: ViewportHighlightColor;
    /** Neutral line color used for the visible temporal window boundary lines. */
    readonly getLineColor?: ViewportHighlightColor;
    /** Minimum pixel width used for the visible temporal window boundary lines. */
    readonly lineWidthMinPixels?: number;
  };

/**
 * Computes minimap overlay geometry from a viewport's X bounds and the minimap bounds.
 */
export function getViewportHighlightOverlayData({
  viewportBounds,
  overviewBounds,
  xOffset = 0
}: {
  /** Main viewport bounds returned by `Viewport.getBounds()`. Only X coordinates are used. */
  readonly viewportBounds: readonly [number, number, number, number];
  /** Minimap bounds that provide X clamps and full-height Y coordinates. */
  readonly overviewBounds: Bounds;
  /** Optional X offset applied before clamping viewport bounds into minimap coordinates. */
  readonly xOffset?: number;
}): ViewportHighlightOverlayData {
  const overviewMinX = Math.min(overviewBounds[0][0], overviewBounds[1][0]);
  const overviewMaxX = Math.max(overviewBounds[0][0], overviewBounds[1][0]);
  const overviewMinY = Math.min(overviewBounds[0][1], overviewBounds[1][1]);
  const overviewMaxY = Math.max(overviewBounds[0][1], overviewBounds[1][1]);
  const rawMinX = Math.min(viewportBounds[0] + xOffset, viewportBounds[2] + xOffset);
  const rawMaxX = Math.max(viewportBounds[0] + xOffset, viewportBounds[2] + xOffset);
  const visibleMinX = clamp(rawMinX, overviewMinX, overviewMaxX);
  const visibleMaxX = clamp(rawMaxX, overviewMinX, overviewMaxX);
  const hiddenIntervals: ViewportHighlightHiddenInterval[] = [];

  if (visibleMinX > overviewMinX) {
    hiddenIntervals.push({
      polygon: [
        [overviewMinX, overviewMinY],
        [visibleMinX, overviewMinY],
        [visibleMinX, overviewMaxY],
        [overviewMinX, overviewMaxY]
      ]
    });
  }
  if (visibleMaxX < overviewMaxX) {
    hiddenIntervals.push({
      polygon: [
        [visibleMaxX, overviewMinY],
        [overviewMaxX, overviewMinY],
        [overviewMaxX, overviewMaxY],
        [visibleMaxX, overviewMaxY]
      ]
    });
  }

  const boundaryLines = dedupeNumbers([visibleMinX, visibleMaxX])
    .filter(x => x > overviewMinX && x < overviewMaxX)
    .map(x => ({
      path: [
        [x, overviewMinY],
        [x, overviewMaxY]
      ] as [number, number][]
    }));

  return {hiddenIntervals, boundaryLines};
}

export class ViewportHighlightLayer extends CompositeLayer<ViewportHighlightLayerProps> {
  static layerName = 'ViewportHighlightLayer';

  declare state: {
    viewports: Viewport[];
  };

  // Called whenever props/data/viewports change
  override shouldUpdateState(params: UpdateParameters<this>): boolean {
    const deck = this.context.deck;
    if (!deck) return false;

    const {highlightedViewportIds} = this.props;
    const viewports = deck.getViewports();
    const highlightedViewports = highlightedViewportIds
      .map(id => viewports.find(v => v.id === id))
      .filter(Boolean);
    const viewportsChanged = !deepEqual(highlightedViewports, this.state.viewports, 1);
    if (viewportsChanged) {
      this.setState({viewports: highlightedViewports});
    }
    return viewportsChanged || super.shouldUpdateState(params);
  }

  renderLayers(): Layer | Layer[] | null {
    const {bounds, xOffset = 0} = this.props;
    const overlayData = (this.state.viewports ?? []).map(viewport =>
      getViewportHighlightOverlayData({
        viewportBounds: viewport.getBounds() as [number, number, number, number],
        overviewBounds: bounds,
        xOffset
      })
    );
    const hiddenIntervals = overlayData.flatMap(data => data.hiddenIntervals);
    const boundaryLines = overlayData.flatMap(data => data.boundaryLines);

    const hiddenIntervalsLayer = new PolygonLayer<ViewportHighlightHiddenInterval>(
      this.getSubLayerProps({
        id: 'hidden-intervals',
        visible: hiddenIntervals.length > 0
      }),
      {
        data: hiddenIntervals,
        positionFormat: 'XY',
        getPolygon: interval => interval.polygon,
        getFillColor: this.props.getFillColor ?? ([15, 23, 42, 38] as const),
        stroked: false,
        pickable: false,
        parameters: {blend: true, depthWriteEnabled: false, depthCompare: 'always'}
      }
    );
    const boundaryLinesLayer = new PathLayer<ViewportHighlightBoundaryLine>(
      this.getSubLayerProps({
        id: 'boundary-lines',
        visible: boundaryLines.length > 0
      }),
      {
        data: boundaryLines,
        positionFormat: 'XY',
        getPath: line => line.path,
        getColor: this.props.getLineColor ?? ([15, 23, 42, 130] as const),
        widthUnits: 'pixels',
        widthMinPixels: this.props.lineWidthMinPixels ?? 2,
        pickable: false
      }
    );

    return [hiddenIntervalsLayer, boundaryLinesLayer];
  }
}

/**
 * Clamps a numeric value into an inclusive range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Returns numbers in first-seen order while removing duplicates.
 */
function dedupeNumbers(values: readonly number[]): number[] {
  const seen = new Set<number>();
  const deduped: number[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}
