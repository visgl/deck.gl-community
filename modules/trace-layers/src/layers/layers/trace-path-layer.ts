import {
  CompositeLayer,
  COORDINATE_SYSTEM,
  FilterContext,
  GetPickingInfoParams,
  LayerProps,
  PickingInfo
} from '@deck.gl/core';
import {BlockLayer} from '@deck.gl-community/infovis-layers';
import {DependencyArrowLayer, PathDirection} from '@deck.gl-community/layers';

import {
  createTraceColorResolver,
  DEFAULT_PATH_HIGHLIGHT_TRAIL_LENGTH,
  DEFAULT_TRACE_COLOR_SCHEME,
  MAX_PATH_HIGHLIGHT_TRAIL_LENGTH,
  MIN_PATH_HIGHLIGHT_TRAIL_LENGTH,
  TRACE_COLOR
} from '../../trace/trace-style/trace-colors';
import {combineBounds, expandBounds} from './layer-bounds-utils';
import {
  makeColorUpdateTriggers,
  makeGeometryUpdateTriggers,
  TRACE_SPAN_POSITION_TRANSITION
} from './trace-layer-utils';
import {
  getTraceLayoutPathDependencyGeometry,
  getTraceLayoutSpanGeometryBySpanRef
} from './trace-layout-geometry';

import type {TraceGraphPathBlockSource, TraceGraphPathDependencySource} from '../../trace/index';
import type {SpanRef, TraceVisSettings} from '../../trace/trace-graph/trace-types';
import type {TraceLayout} from '../../trace/trace-layout/trace-layout';
import type {TraceColorScheme} from '../../trace/trace-style/trace-colors';

const DEFAULT_SPAN_WIDTH_MIN_PIXELS = 2;
const PATH_DEPENDENCY_LINE_WIDTH_PX = 3;
const PATH_DEPENDENCY_MARKER_SIZE = 2;
const FORWARD_DEPENDENCY_MARKER_PLACEMENTS = [1];
const BIDIRECTIONAL_DEPENDENCY_MARKER_PLACEMENTS = [1];
const EMPTY_LAYER_UPDATE_TRIGGER = {};
const EMPTY_LAYER_UPDATE_TRIGGERS = [EMPTY_LAYER_UPDATE_TRIGGER];
/**
 * Composite layer that renders the highlighted execution path overlay.
 *
 * Sublayer identifiers:
 * - `${id}-block-rectangles`: rectangles representing spans in the path.
 * - `${id}-dependency-lines`: dependency lines + chevrons associated with the path.
 */
export type TracePathLayerProps = LayerProps & {
  /** Exact visible block sources keyed by canonical span refs. */
  blockSources: readonly TraceGraphPathBlockSource[];
  /** Exact visible dependency sources keyed by canonical visible dependency refs. */
  dependencySources: readonly TraceGraphPathDependencySource[];
  /** Click handler for path spans after wrapper sources are unwrapped. */
  onSpanClick: (info: PickingInfo) => boolean | void;
  /** Rank index used for deck-specific picking context. */
  rankIndex: number;
  /** Layout containing the canonical ref-keyed geometry for this path overlay. */
  traceLayout: TraceLayout;
  /** Active rendering settings for the path overlay. */
  settings: TraceVisSettings;
  /** Optional color scheme used for block fill and line styling. */
  colorScheme?: TraceColorScheme;
  /** Canonical highlighted span refs used for compatibility color calculations. */
  highlightedSpanRefs?: ReadonlySet<SpanRef>;
  /** Canonical highlighted path span refs used to emphasize active path spans. */
  highlightedPathSpanRefs?: ReadonlySet<SpanRef>;
  /** Animated path trail entries keyed by exact visible block sources. */
  pathHighlightTrail?: readonly PathHighlightTrailDatum[];
  /** Effective path playback trail length. */
  pathHighlightTrailLength: number;
};

type PathHighlightTrailDatum = {blockSource: TraceGraphPathBlockSource; age: number};
const EMPTY_PATH_BLOCK_SOURCES: readonly TraceGraphPathBlockSource[] = [];
const EMPTY_PATH_DEPENDENCY_SOURCES: readonly TraceGraphPathDependencySource[] = [];
const EMPTY_PATH_HIGHLIGHT_TRAIL: readonly PathHighlightTrailDatum[] = [];

function getPathBlockSourceBounds(
  blockSources: readonly TraceGraphPathBlockSource[],
  traceLayout: TraceLayout
): [[number, number], [number, number]] | null {
  return combineBounds(
    blockSources.map(blockSource => {
      const bbox = getTraceLayoutSpanGeometryBySpanRef({
        traceLayout,
        spanRef: blockSource.spanRef
      });
      return bbox
        ? [
            [bbox[0], bbox[1]],
            [bbox[2], bbox[3]]
          ]
        : null;
    })
  );
}

function getPathDependencySourceBounds(
  dependencySources: readonly TraceGraphPathDependencySource[],
  traceLayout: TraceLayout
): [[number, number], [number, number]] | null {
  return combineBounds(
    dependencySources.map(source => {
      const geometry = getTraceLayoutPathDependencyGeometry({
        traceLayout,
        source
      });
      if (!geometry || geometry.length < 2) {
        return null;
      }

      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < geometry.length; index += 2) {
        const x = geometry[index];
        const y = geometry[index + 1];
        if (
          typeof x !== 'number' ||
          typeof y !== 'number' ||
          !Number.isFinite(x) ||
          !Number.isFinite(y)
        ) {
          continue;
        }
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      return Number.isFinite(minX) &&
        Number.isFinite(minY) &&
        Number.isFinite(maxX) &&
        Number.isFinite(maxY)
        ? [
            [minX, minY],
            [maxX, maxY]
          ]
        : null;
    })
  );
}

function getPathBlockPosition(
  blockSource: TraceGraphPathBlockSource,
  traceLayout: TraceLayout
): [number, number] {
  const bbox = getTraceLayoutSpanGeometryBySpanRef({
    traceLayout,
    spanRef: blockSource.spanRef
  });
  return bbox ? [bbox[0], bbox[1]] : [0, 0];
}

function getPathBlockSize(
  blockSource: TraceGraphPathBlockSource,
  traceLayout: TraceLayout
): [number, number] {
  const bbox = getTraceLayoutSpanGeometryBySpanRef({
    traceLayout,
    spanRef: blockSource.spanRef
  });
  return bbox ? [bbox[2] - bbox[0], bbox[3] - bbox[1]] : [0, 0];
}

export class TracePathLayer extends CompositeLayer<TracePathLayerProps> {
  static layerName = 'TracePathLayer';

  static defaultProps: Required<Omit<TracePathLayerProps, keyof LayerProps>> = {
    blockSources: [],
    dependencySources: [],
    onSpanClick: () => false,
    rankIndex: 0,
    traceLayout: undefined!,
    settings: undefined!,
    colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
    highlightedSpanRefs: undefined!,
    highlightedPathSpanRefs: undefined!,
    pathHighlightTrail: undefined!,
    pathHighlightTrailLength: DEFAULT_PATH_HIGHLIGHT_TRAIL_LENGTH
  };

  override getBounds() {
    const {traceLayout, blockSources, dependencySources} = this.props;
    return expandBounds(
      combineBounds([
        getPathBlockSourceBounds(blockSources, traceLayout),
        getPathDependencySourceBounds(dependencySources, traceLayout)
      ])
    );
  }

  override getPickingInfo(
    params: GetPickingInfoParams
  ): PickingInfo<TraceGraphPathBlockSource['span'] | TraceGraphPathDependencySource['dependency']> {
    const info = super.getPickingInfo(params) as PickingInfo<
      | TraceGraphPathBlockSource
      | TraceGraphPathDependencySource
      | PathHighlightTrailDatum
      | TraceGraphPathBlockSource['span']
      | TraceGraphPathDependencySource['dependency']
    >;
    const object = info.object;
    if (object && typeof object === 'object') {
      if ('span' in object) {
        info.object = object.span;
      } else if ('dependency' in object) {
        info.object = object.dependency;
      } else if ('blockSource' in object) {
        info.object = object.blockSource.span;
      }
    }
    return info as PickingInfo<
      TraceGraphPathBlockSource['span'] | TraceGraphPathDependencySource['dependency']
    >;
  }

  /** By default layerFilter only apply to top-level layers
   * In this case we want TraceProcessLayer's sub layers to have per-view visibility as well
   */
  filterSubLayer(context: FilterContext): boolean {
    const layerFilter = this.context.deck?.props.layerFilter;
    if (layerFilter) {
      return layerFilter(context);
    }
    return true;
  }

  renderLayers() {
    const {
      blockSources,
      dependencySources,
      onSpanClick,
      rankIndex,
      traceLayout,
      settings,
      colorScheme = DEFAULT_TRACE_COLOR_SCHEME,
      highlightedSpanRefs,
      highlightedPathSpanRefs,
      pathHighlightTrail,
      pathHighlightTrailLength
    } = this.props;

    const trailLength = Math.max(
      MIN_PATH_HIGHLIGHT_TRAIL_LENGTH,
      Math.min(pathHighlightTrailLength, MAX_PATH_HIGHLIGHT_TRAIL_LENGTH)
    );

    const geometryUpdateTriggers = makeGeometryUpdateTriggers(settings, traceLayout);
    const colorUpdateTriggers = [
      ...makeColorUpdateTriggers(settings, highlightedSpanRefs),
      colorScheme
    ];
    const colorResolver = createTraceColorResolver({
      colorScheme,
      settings,
      highlightedSpanRefs
    });
    const minSpanWidthPixels = settings.minSpanWidthPixels ?? DEFAULT_SPAN_WIDTH_MIN_PIXELS;

    const hasPathBlocks = blockSources.length > 0;
    const highlightedBlocks: readonly TraceGraphPathBlockSource[] =
      hasPathBlocks && highlightedPathSpanRefs && highlightedPathSpanRefs.size > 0
        ? blockSources.filter(blockSource => highlightedPathSpanRefs.has(blockSource.spanRef))
        : EMPTY_PATH_BLOCK_SOURCES;

    const trailBlocks: readonly PathHighlightTrailDatum[] =
      pathHighlightTrail && pathHighlightTrail.length > 0
        ? pathHighlightTrail.map(({blockSource, age}) => ({
            blockSource,
            age
          }))
        : EMPTY_PATH_HIGHLIGHT_TRAIL;
    const dependenciesWithGeometry: readonly TraceGraphPathDependencySource[] =
      dependencySources.length > 0
        ? dependencySources.filter(dependencySource =>
            Boolean(
              getTraceLayoutPathDependencyGeometry({
                traceLayout,
                source: dependencySource
              })
            )
          )
        : EMPTY_PATH_DEPENDENCY_SOURCES;
    const blockGeometryUpdateTriggers = hasPathBlocks
      ? geometryUpdateTriggers
      : EMPTY_LAYER_UPDATE_TRIGGERS;
    const blockColorUpdateTriggers = hasPathBlocks
      ? colorUpdateTriggers
      : EMPTY_LAYER_UPDATE_TRIGGERS;
    const highlightedBlockUpdateTriggers =
      highlightedBlocks.length > 0 ? geometryUpdateTriggers : EMPTY_LAYER_UPDATE_TRIGGERS;
    const highlightedBlockColorUpdateTriggers =
      highlightedBlocks.length > 0 ? [highlightedPathSpanRefs] : EMPTY_LAYER_UPDATE_TRIGGERS;
    const trailBlockUpdateTriggers =
      trailBlocks.length > 0 ? geometryUpdateTriggers : EMPTY_LAYER_UPDATE_TRIGGERS;
    const trailBlockColorUpdateTriggers =
      trailBlocks.length > 0 ? [pathHighlightTrail] : EMPTY_LAYER_UPDATE_TRIGGERS;
    const dependencyUpdateTriggers =
      dependenciesWithGeometry.length > 0 ? geometryUpdateTriggers : EMPTY_LAYER_UPDATE_TRIGGERS;

    const dependencyLineLayer = new DependencyArrowLayer<
      TraceGraphPathDependencySource,
      {rankIndex: number}
    >(
      this.getSubLayerProps({
        id: 'dependency-lines',
        visible: settings.showDependencies && dependenciesWithGeometry.length > 0
      }),
      {
        data: dependenciesWithGeometry,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        positionFormat: 'XY',
        getPath: (dependencySource: TraceGraphPathDependencySource) =>
          getTraceLayoutPathDependencyGeometry({
            traceLayout,
            source: dependencySource
          }) ?? [],
        getColor: TRACE_COLOR.DEPENDENCY_IN_CRITICAL_PATH_LINE,
        // getMarkerColor: TRACE_COLOR.DEPENDENCY_IN_CRITICAL_PATH_LINE,
        getDirection: (dependencySource: TraceGraphPathDependencySource) =>
          dependencySource.dependency.bidirectional ? PathDirection.BOTH : PathDirection.FORWARD,
        getMarkerPlacements: (dependencySource: TraceGraphPathDependencySource) =>
          dependencySource.dependency.bidirectional
            ? BIDIRECTIONAL_DEPENDENCY_MARKER_PLACEMENTS
            : FORWARD_DEPENDENCY_MARKER_PLACEMENTS,
        getMarkerSize: [2, 1],
        markerSizeScale: PATH_DEPENDENCY_LINE_WIDTH_PX * PATH_DEPENDENCY_MARKER_SIZE,
        updateTriggers: {
          getPath: dependencyUpdateTriggers,
          getColor:
            dependenciesWithGeometry.length > 0 ? colorUpdateTriggers : EMPTY_LAYER_UPDATE_TRIGGERS
        },
        ...(settings.transitions
          ? {
              transitions: {
                getPath: TRACE_SPAN_POSITION_TRANSITION
              }
            }
          : {}),
        getWidth: PATH_DEPENDENCY_LINE_WIDTH_PX,
        widthUnits: 'pixels',
        pickable: true,
        autoHighlight: true,
        highlightColor: TRACE_COLOR.DEPENDENCY_HIGHLIGHT as [number, number, number, number],
        mode: settings.lineRoutingMode === 'curve' ? 'arc' : 'line',
        getArcTilt: 90,
        getArcHeight: 0.3,
        rankIndex,
        parameters: {
          blend: false,
          depthWriteEnabled: false,
          depthCompare: 'always'
        }
      }
    );

    const blockRectangleLayer = new BlockLayer<TraceGraphPathBlockSource, {rankIndex: number}>(
      this.getSubLayerProps({
        id: 'block-rectangles',
        visible: hasPathBlocks
      }),
      {
        data: blockSources,
        opacity: settings.showPathsOnly ? 0.7 : 1,
        positionFormat: 'XY',
        updateTriggers: {
          getPosition: blockGeometryUpdateTriggers,
          getSize: blockGeometryUpdateTriggers,
          getFillColor: blockColorUpdateTriggers,
          getLineColor: blockColorUpdateTriggers
        },
        ...(settings.transitions
          ? {
              transitions: {
                getPosition: TRACE_SPAN_POSITION_TRANSITION,
                getSize: TRACE_SPAN_POSITION_TRANSITION
              }
            }
          : {}),
        parameters: {
          blend: false,
          depthWriteEnabled: true,
          depthCompare: 'less-equal'
        },
        getPosition: (blockSource: TraceGraphPathBlockSource) =>
          getPathBlockPosition(blockSource, traceLayout),
        getSize: (blockSource: TraceGraphPathBlockSource) =>
          getPathBlockSize(blockSource, traceLayout),
        getFillColor: (blockSource: TraceGraphPathBlockSource) => {
          const color = [...colorResolver.getSpanFillColor(blockSource.span, 'path')];
          if (
            highlightedPathSpanRefs &&
            highlightedPathSpanRefs.size > 0 &&
            !highlightedPathSpanRefs.has(blockSource.spanRef)
          ) {
            color[3] = Math.round(color[3] * 0.7);
          }
          return color as [number, number, number, number];
        },
        getLineColor: (blockSource: TraceGraphPathBlockSource) => {
          const color = [...colorResolver.getSpanBorderColor(blockSource.span, 'path')];
          if (
            highlightedPathSpanRefs &&
            highlightedPathSpanRefs.size > 0 &&
            !highlightedPathSpanRefs.has(blockSource.spanRef)
          ) {
            color[3] = Math.round(color[3] * 0.7);
          }
          return color as [number, number, number, number];
        },
        getLineWidth: 1.5,
        widthMinPixels: minSpanWidthPixels,
        heightMinPixels: 1,
        lineWidthUnits: 'pixels',
        pickable: true,
        autoHighlight: true,
        highlightColor: TRACE_COLOR.SPAN_HIGHLIGHT as [number, number, number, number],
        onClick: onSpanClick,
        rankIndex
      }
    );

    const blockRectangleHighlightedLayer = new BlockLayer<
      TraceGraphPathBlockSource,
      {rankIndex: number}
    >(
      this.getSubLayerProps({
        id: 'block-rectangles-highlighted',
        visible: highlightedBlocks.length > 0
      }),
      {
        data: highlightedBlocks,
        positionFormat: 'XY',
        updateTriggers: {
          getPosition: highlightedBlockUpdateTriggers,
          getSize: highlightedBlockUpdateTriggers,
          getFillColor: highlightedBlockColorUpdateTriggers,
          getLineColor: highlightedBlockColorUpdateTriggers,
          getLineWidth: highlightedBlockColorUpdateTriggers
        },
        ...(settings.transitions
          ? {
              transitions: {
                getPosition: TRACE_SPAN_POSITION_TRANSITION,
                getSize: TRACE_SPAN_POSITION_TRANSITION
              }
            }
          : {}),
        parameters: {
          blend: false,
          depthWriteEnabled: true,
          depthCompare: 'less-equal'
        },
        getPosition: (blockSource: TraceGraphPathBlockSource) =>
          getPathBlockPosition(blockSource, traceLayout),
        getSize: (blockSource: TraceGraphPathBlockSource) =>
          getPathBlockSize(blockSource, traceLayout),
        getFillColor: () => TRACE_COLOR.SPAN_IN_CRITICAL_PATH_HIGHLIGHT_FILL,
        getLineColor: () => TRACE_COLOR.SPAN_IN_CRITICAL_PATH_HIGHLIGHT_LINE,
        getLineWidth: 6,
        widthMinPixels: minSpanWidthPixels,
        heightMinPixels: 1,
        lineWidthUnits: 'pixels',
        pickable: true,
        autoHighlight: true,
        highlightColor: TRACE_COLOR.SPAN_HIGHLIGHT as [number, number, number, number],
        onClick: onSpanClick,
        rankIndex
      }
    );

    const blockRectangleTrailLayer = new BlockLayer<
      {blockSource: TraceGraphPathBlockSource; age: number},
      {rankIndex: number}
    >(
      this.getSubLayerProps({
        id: 'block-rectangles-trail',
        visible: trailBlocks.length > 0
      }),
      {
        data: trailBlocks,
        positionFormat: 'XY',
        updateTriggers: {
          getPosition: trailBlockUpdateTriggers,
          getSize: trailBlockUpdateTriggers,
          getFillColor: trailBlockColorUpdateTriggers,
          getLineColor: trailBlockColorUpdateTriggers,
          getLineWidth: trailBlockColorUpdateTriggers
        },
        ...(settings.transitions
          ? {
              transitions: {
                getPosition: TRACE_SPAN_POSITION_TRANSITION,
                getSize: TRACE_SPAN_POSITION_TRANSITION
              }
            }
          : {}),
        parameters: {
          blend: false,
          depthWriteEnabled: true,
          depthCompare: 'less-equal'
        },
        getPosition: ({blockSource}: PathHighlightTrailDatum) =>
          getPathBlockPosition(blockSource, traceLayout),
        getSize: ({blockSource}: PathHighlightTrailDatum) =>
          getPathBlockSize(blockSource, traceLayout),
        getFillColor: ({age}: PathHighlightTrailDatum) => {
          const alphaScale = Math.max(0.2, (trailLength - age) / trailLength);
          const color = [...TRACE_COLOR.SPAN_IN_CRITICAL_PATH_HIGHLIGHT_FILL];
          color[3] = Math.round(color[3] * alphaScale);
          return color as [number, number, number, number];
        },
        getLineColor: ({age}: PathHighlightTrailDatum) => {
          const alphaScale = Math.max(0.2, (trailLength - age) / trailLength);
          const color = [...TRACE_COLOR.SPAN_IN_CRITICAL_PATH_HIGHLIGHT_LINE];
          color[3] = Math.round(color[3] * alphaScale);
          return color as [number, number, number, number];
        },
        getLineWidth: ({age}: PathHighlightTrailDatum) => Math.max(1, 5 - age * 0.6),
        lineWidthUnits: 'pixels',
        pickable: true,
        autoHighlight: true,
        highlightColor: TRACE_COLOR.SPAN_HIGHLIGHT as [number, number, number, number],
        onClick: onSpanClick,
        rankIndex
      }
    );

    return [
      blockRectangleLayer,
      blockRectangleTrailLayer,
      blockRectangleHighlightedLayer,
      dependencyLineLayer
    ];
  }
}
