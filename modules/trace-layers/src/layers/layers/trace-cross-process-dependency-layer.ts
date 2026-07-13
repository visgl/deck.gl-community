import {CompositeLayer, LayerProps} from '@deck.gl/core';
import {LineLayer} from '@deck.gl/layers';
import {DependencyArrowLayer, PathDirection} from '@deck.gl-community/layers';

import {
  buildTraceLayoutGeometryDerivationContext,
  getCrossRankDependencyLineColor,
  getSelectedCrossRankDependencyLineColor,
  getTraceLayoutDependencyRenderSource,
  isCrossProcessDependencyRef,
  TRACE_COLOR,
  TraceColorScheme
} from '../../trace';
import {combineBounds, expandBounds, getCrossProcessDependencyBounds} from './layer-bounds-utils';
import {
  applyDependencyLineOpacity,
  applyDependencyMarkerOpacity,
  getDependencyOpacityMultiplier,
  makeColorUpdateTriggers,
  makeGeometryUpdateTriggers,
  TRACE_SPAN_POSITION_TRANSITION
} from './trace-layer-utils';
import {
  getTraceLayoutSelectedCrossProcessDependencyGeometry,
  getTraceLayoutSpanVisibilityBySpanRef,
  getTraceLayoutVisibleCrossProcessDependencyGeometry
} from './trace-layout-geometry';

import type {
  CrossProcessDependencyRef,
  TraceCrossProcessDependency,
  TraceCrossProcessDependencyRenderSource,
  TraceDeckBinaryCrossProcessDependencyLineData,
  TraceGraphSelectedCrossProcessDependencySource,
  TraceLayout,
  TraceLayoutGeometryDerivationContext,
  TraceRefSource,
  TraceVisSettings
} from '../../trace';
import type {GetPickingInfoParams, PickingInfo, UpdateParameters} from '@deck.gl/core';

const CROSS_PROCESS_DEPENDENCY_LINE_WIDTH_PX = 1;
const CROSS_PROCESS_DEPENDENCY_OPACITY_MULTIPLIER = 0.75;
const SELECTED_CROSS_PROCESS_DEPENDENCY_LINE_WIDTH_PX = 2;
const PATH_DEPENDENCY_MARKER_SIZE = 3;
const FORWARD_DEPENDENCY_MARKER_PLACEMENTS = [1];
const BIDIRECTIONAL_DEPENDENCY_MARKER_PLACEMENTS = [1];
const SELECTED_CROSS_PROCESS_DEPENDENCY_PARAMETERS = {
  blend: false,
  depthTest: true,
  depthWriteEnabled: true,
  depthCompare: 'always'
} as const;
const EMPTY_SELECTED_CROSS_PROCESS_DEPENDENCIES: readonly TraceSelectedCrossProcessDependencySource[] =
  [];
const EMPTY_CROSS_PROCESS_DEPENDENCY_REFS: TraceRefSource<CrossProcessDependencyRef> =
  Object.freeze({
    length: 0,
    at: () => undefined,
    *[Symbol.iterator](): Iterator<CrossProcessDependencyRef> {}
  });
const EMPTY_LAYER_UPDATE_TRIGGER = {};
const EMPTY_LAYER_UPDATE_TRIGGERS = [EMPTY_LAYER_UPDATE_TRIGGER];

type TraceSelectedCrossProcessDependencyCandidate =
  | TraceCrossProcessDependencyRenderSource
  | TraceCrossProcessDependency
  | TraceGraphSelectedCrossProcessDependencySource;

type TraceSelectedCrossProcessDependencySource = TraceSelectedCrossProcessDependencyCandidate & {
  /** Exact visible dependency ref used for selected-overlay geometry. */
  dependencyRef: CrossProcessDependencyRef;
  /** Optional selected-dependency direction; missing values render as incoming. */
  selectedDirection?: TraceGraphSelectedCrossProcessDependencySource['selectedDirection'];
};

type TraceCrossProcessDependencyLayerState = {
  /** Selected cross-process dependency sources that carry exact visible dependency refs. */
  visibleSelectedCrossProcessDependencies: readonly TraceSelectedCrossProcessDependencySource[];
};

/**
 * Returns true when two selected cross-process dependencies produce the same selected-overlay geometry and
 * styling.
 */
function areSameSelectedCrossProcessDependency(
  previous: TraceSelectedCrossProcessDependencySource,
  next: TraceSelectedCrossProcessDependencySource
): boolean {
  return (
    previous.dependencyRef === next.dependencyRef &&
    previous.selectedDirection === next.selectedDirection &&
    previous.waitTimeMs === next.waitTimeMs &&
    previous.bidirectional === next.bidirectional
  );
}

/** Returns true when two selected cross-process dependency arrays are equivalent for deck attributes. */
function areSameSelectedCrossProcessDependencies(
  previous: readonly TraceSelectedCrossProcessDependencySource[],
  next: readonly TraceSelectedCrossProcessDependencySource[]
): boolean {
  return (
    previous.length === next.length &&
    previous.every((dependency, index) =>
      areSameSelectedCrossProcessDependency(
        dependency,
        next[index] as TraceSelectedCrossProcessDependencySource
      )
    )
  );
}

/** Narrows cross-process dependency sources to entries that carry visible dependency refs. */
function hasCrossProcessDependencyRef(
  dependency: TraceSelectedCrossProcessDependencyCandidate
): dependency is TraceSelectedCrossProcessDependencySource {
  return dependency.dependencyRef != null && isCrossProcessDependencyRef(dependency.dependencyRef);
}

/** Returns selected cross-process dependencies, preserving the original array when every item is visible. */
function getCrossProcessDependencyRefs(
  dependencies: Readonly<TraceSelectedCrossProcessDependencyCandidate[]>
): readonly TraceSelectedCrossProcessDependencySource[] {
  if (dependencies.every(hasCrossProcessDependencyRef)) {
    return dependencies as readonly TraceSelectedCrossProcessDependencySource[];
  }
  return dependencies.filter(hasCrossProcessDependencyRef);
}

/** Returns the base color for a cross-process dependency ref, including hidden-endpoint styling. */
function getCrossProcessDependencyBaseLineColorByRef(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: CrossProcessDependencyRef,
  settings: TraceVisSettings,
  context: TraceLayoutGeometryDerivationContext
) {
  return hasHiddenCrossProcessDependencyEndpointByRef(traceLayout, dependencyRef, context)
    ? TRACE_COLOR.CROSS_PROCESS_DEPENDENCY_HIDDEN_ENDPOINT_LINE
    : getCrossRankDependencyLineColor(
        {waitTimeMs: traceLayout.traceGraph.getDependencyWaitTimeMs(dependencyRef) ?? 0},
        settings
      );
}

/** Returns true when either endpoint span of one dependency ref is layout-hidden for the current view. */
function hasHiddenCrossProcessDependencyEndpointByRef(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: CrossProcessDependencyRef,
  context: TraceLayoutGeometryDerivationContext
): boolean {
  const traceGraph = traceLayout.traceGraph;
  const startSpanRef = traceGraph.getDependencyStartSpan(dependencyRef);
  const endSpanRef = traceGraph.getDependencyEndSpan(dependencyRef);
  const startVisibility =
    startSpanRef != null
      ? getTraceLayoutSpanVisibilityBySpanRef({
          traceLayout,
          spanRef: startSpanRef,
          context
        })
      : undefined;
  const endVisibility =
    endSpanRef != null
      ? getTraceLayoutSpanVisibilityBySpanRef({
          traceLayout,
          spanRef: endSpanRef,
          context
        })
      : undefined;
  return startVisibility?.visible === false || endVisibility?.visible === false;
}

/** Resolves one ref-native base dependency path without materializing a dependency object. */
function getCrossProcessDependencyPathByRef(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: CrossProcessDependencyRef,
  context: TraceLayoutGeometryDerivationContext
) {
  return (
    getTraceLayoutVisibleCrossProcessDependencyGeometry({
      traceLayout,
      dependencyRef,
      context
    }) ?? []
  );
}

/** Resolves one picked base dependency ref back to the public render-source payload. */
function getPickedCrossProcessDependencySource(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: CrossProcessDependencyRef | undefined
): TraceCrossProcessDependencyRenderSource | undefined {
  if (dependencyRef == null || !isCrossProcessDependencyRef(dependencyRef)) {
    return undefined;
  }
  const source = getTraceLayoutDependencyRenderSource(traceLayout.traceGraph, dependencyRef);
  return source?.type === 'trace-cross-process-dependency' ? source : undefined;
}

/**
 * Composite layer that renders cross-process dependencies.
 *
 * Sublayer identifiers:
 * - `${id}-straight-lines`: binary straight cross-process dependency segments.
 * - `${id}-routed-lines`: routed cross-process dependency polylines.
 * - `${id}-selected-lines`: highlighted selection overlay.
 */
export type TraceCrossProcessDependencyLayerProps = LayerProps & {
  /** Theme-owned colors used to style dependency lines and selection overlays. */
  colorScheme?: TraceColorScheme;
  /** Ref-native visible cross-process dependencies for the active graph. */
  crossProcessDependencyRefs: TraceRefSource<CrossProcessDependencyRef>;
  /** Optional compact binary payload used by straight base dependency lines. */
  binaryCrossProcessDependencyLineData?: TraceDeckBinaryCrossProcessDependencyLineData;
  /** Selected dependency sources before layer state narrows them to visible dependency refs. */
  selectedCrossProcessDependencies: readonly TraceSelectedCrossProcessDependencyCandidate[];
  /** Active trace visualization settings that control dependency visibility and styling. */
  settings: TraceVisSettings;
  /** Prepared layout used to resolve dependency endpoints into rendered geometry. */
  traceLayout: Readonly<TraceLayout>;
};

export class TraceCrossProcessDependencyLayer extends CompositeLayer<TraceCrossProcessDependencyLayerProps> {
  static layerName = 'TraceCrossProcessDependencyLayer';

  static defaultProps: Required<Omit<TraceCrossProcessDependencyLayerProps, keyof LayerProps>> = {
    crossProcessDependencyRefs: EMPTY_CROSS_PROCESS_DEPENDENCY_REFS,
    binaryCrossProcessDependencyLineData: undefined!,
    selectedCrossProcessDependencies: [],
    colorScheme: undefined!,
    settings: undefined!,
    traceLayout: undefined!
  };

  override updateState({props, oldProps}: UpdateParameters<this>) {
    const previousVisibleSelectedCrossProcessDependencies =
      (this.state as Partial<TraceCrossProcessDependencyLayerState>)
        .visibleSelectedCrossProcessDependencies ?? EMPTY_SELECTED_CROSS_PROCESS_DEPENDENCIES;

    if (
      props.selectedCrossProcessDependencies === oldProps.selectedCrossProcessDependencies &&
      previousVisibleSelectedCrossProcessDependencies.length > 0
    ) {
      return;
    }

    const nextVisibleSelectedCrossProcessDependencies = getCrossProcessDependencyRefs(
      props.selectedCrossProcessDependencies
    );
    if (
      areSameSelectedCrossProcessDependencies(
        previousVisibleSelectedCrossProcessDependencies,
        nextVisibleSelectedCrossProcessDependencies
      )
    ) {
      return;
    }

    this.setState({
      visibleSelectedCrossProcessDependencies: nextVisibleSelectedCrossProcessDependencies
    } satisfies TraceCrossProcessDependencyLayerState);
  }

  /** Initializes derived state for direct renderLayers calls outside deck.gl's lifecycle. */
  private ensureDerivedState() {
    if (this.state) {
      return;
    }

    this.state = {};
    this.updateState({
      props: this.props,
      oldProps: {} as TraceCrossProcessDependencyLayerProps
    } as UpdateParameters<this>);
  }

  override getBounds() {
    this.ensureDerivedState();
    const {traceLayout, crossProcessDependencyRefs} = this.props;
    const {visibleSelectedCrossProcessDependencies = EMPTY_SELECTED_CROSS_PROCESS_DEPENDENCIES} =
      this.state as Partial<TraceCrossProcessDependencyLayerState>;
    return expandBounds(
      combineBounds([
        getCrossProcessDependencyBounds(crossProcessDependencyRefs, traceLayout),
        getCrossProcessDependencyBounds(visibleSelectedCrossProcessDependencies, traceLayout)
      ])
    );
  }

  override getPickingInfo(
    params: GetPickingInfoParams
  ): PickingInfo<
    TraceCrossProcessDependencyRenderSource | TraceSelectedCrossProcessDependencySource
  > {
    const info = super.getPickingInfo(params) as PickingInfo<
      | TraceCrossProcessDependencyRenderSource
      | TraceSelectedCrossProcessDependencySource
      | CrossProcessDependencyRef
    >;
    const sourceLayerId = params.sourceLayer?.id ?? '';
    if (!sourceLayerId.includes('lines')) {
      return info as PickingInfo<
        TraceCrossProcessDependencyRenderSource | TraceSelectedCrossProcessDependencySource
      >;
    }

    if (info.object == null && info.index >= 0) {
      const dependencyRefs =
        this.props.binaryCrossProcessDependencyLineData?.dependencies ??
        this.props.crossProcessDependencyRefs;
      info.object = getPickedCrossProcessDependencySource(
        this.props.traceLayout,
        dependencyRefs.at(info.index)
      );
    } else if (typeof info.object === 'number') {
      info.object = getPickedCrossProcessDependencySource(
        this.props.traceLayout,
        info.object as CrossProcessDependencyRef
      );
    }
    return info as PickingInfo<
      TraceCrossProcessDependencyRenderSource | TraceSelectedCrossProcessDependencySource
    >;
  }

  renderLayers() {
    this.ensureDerivedState();
    const {
      binaryCrossProcessDependencyLineData,
      crossProcessDependencyRefs,
      settings,
      traceLayout
    } = this.props;
    const {visibleSelectedCrossProcessDependencies = EMPTY_SELECTED_CROSS_PROCESS_DEPENDENCIES} =
      this.state as Partial<TraceCrossProcessDependencyLayerState>;

    const geometryUpdateTriggers = makeGeometryUpdateTriggers(settings, traceLayout);
    const colorUpdateTriggers = makeColorUpdateTriggers(settings);
    const crossDependencyCount =
      binaryCrossProcessDependencyLineData?.data.length ?? crossProcessDependencyRefs.length;
    const crossGeometryUpdateTriggers =
      crossDependencyCount > 0 ? geometryUpdateTriggers : EMPTY_LAYER_UPDATE_TRIGGERS;
    const crossColorUpdateTriggers =
      crossDependencyCount > 0
        ? [...colorUpdateTriggers, traceLayout]
        : EMPTY_LAYER_UPDATE_TRIGGERS;
    const selectedGeometryUpdateTriggers =
      visibleSelectedCrossProcessDependencies.length > 0
        ? geometryUpdateTriggers
        : EMPTY_LAYER_UPDATE_TRIGGERS;
    const selectedColorUpdateTriggers =
      visibleSelectedCrossProcessDependencies.length > 0
        ? colorUpdateTriggers
        : EMPTY_LAYER_UPDATE_TRIGGERS;
    const dependencyOpacityMultiplier =
      getDependencyOpacityMultiplier(settings) * CROSS_PROCESS_DEPENDENCY_OPACITY_MULTIPLIER;
    const geometryContext = buildTraceLayoutGeometryDerivationContext(traceLayout);
    const useBinaryStraightLines =
      settings.lineRoutingMode === 'straight' && binaryCrossProcessDependencyLineData != null;
    const crossRankDependencyLineLayer = useBinaryStraightLines
      ? new LineLayer<CrossProcessDependencyRef>(
          this.getSubLayerProps({
            id: 'straight-lines',
            visible: settings.showCrossProcessDependencies && crossDependencyCount > 0
          }),
          {
            data: binaryCrossProcessDependencyLineData.data as never,
            positionFormat: 'XY',
            getSourcePosition: (dependencyRef: CrossProcessDependencyRef) => {
              const path = getCrossProcessDependencyPathByRef(
                traceLayout,
                dependencyRef,
                geometryContext
              );
              return [path[0] ?? 0, path[1] ?? 0, 0];
            },
            getTargetPosition: (dependencyRef: CrossProcessDependencyRef) => {
              const path = getCrossProcessDependencyPathByRef(
                traceLayout,
                dependencyRef,
                geometryContext
              );
              return [path[path.length - 2] ?? 0, path[path.length - 1] ?? 0, 0];
            },
            getColor: (dependencyRef: CrossProcessDependencyRef) =>
              applyDependencyLineOpacity(
                getCrossProcessDependencyBaseLineColorByRef(
                  traceLayout,
                  dependencyRef,
                  settings,
                  geometryContext
                ),
                dependencyOpacityMultiplier
              ),
            getWidth: CROSS_PROCESS_DEPENDENCY_LINE_WIDTH_PX,
            widthUnits: 'pixels',
            pickable: true,
            autoHighlight: true,
            highlightColor: TRACE_COLOR.DEPENDENCY_HIGHLIGHT as [number, number, number, number],
            updateTriggers: {
              getSourcePosition: [binaryCrossProcessDependencyLineData],
              getTargetPosition: [binaryCrossProcessDependencyLineData],
              getColor: [binaryCrossProcessDependencyLineData],
              getWidth: [CROSS_PROCESS_DEPENDENCY_LINE_WIDTH_PX]
            },
            parameters: {
              blend: false,
              depthWriteEnabled: false,
              depthCompare: 'always'
            }
          }
        )
      : new DependencyArrowLayer<CrossProcessDependencyRef>(
          this.getSubLayerProps({
            id: 'routed-lines',
            visible: settings.showCrossProcessDependencies && crossDependencyCount > 0
          }),
          {
            data: crossProcessDependencyRefs,
            positionFormat: 'XY',
            getPath: (dependencyRef: CrossProcessDependencyRef) =>
              getCrossProcessDependencyPathByRef(traceLayout, dependencyRef, geometryContext),
            getColor: (dependencyRef: CrossProcessDependencyRef) =>
              applyDependencyLineOpacity(
                getCrossProcessDependencyBaseLineColorByRef(
                  traceLayout,
                  dependencyRef,
                  settings,
                  geometryContext
                ),
                dependencyOpacityMultiplier
              ),
            getMarkerColor: (dependencyRef: CrossProcessDependencyRef) =>
              applyDependencyMarkerOpacity(
                getCrossProcessDependencyBaseLineColorByRef(
                  traceLayout,
                  dependencyRef,
                  settings,
                  geometryContext
                ),
                dependencyOpacityMultiplier
              ),
            getWidth: CROSS_PROCESS_DEPENDENCY_LINE_WIDTH_PX,
            getMarkerSize: [2, 1],
            markerSizeScale: CROSS_PROCESS_DEPENDENCY_LINE_WIDTH_PX * PATH_DEPENDENCY_MARKER_SIZE,
            getMarkerPlacements: dependencyRef =>
              traceLayout.traceGraph.getDependencyBidirectional(dependencyRef) === true
                ? BIDIRECTIONAL_DEPENDENCY_MARKER_PLACEMENTS
                : FORWARD_DEPENDENCY_MARKER_PLACEMENTS,
            getDirection: dependencyRef =>
              traceLayout.traceGraph.getDependencyBidirectional(dependencyRef) === true
                ? PathDirection.BOTH
                : PathDirection.FORWARD,
            updateTriggers: {
              getPath: crossGeometryUpdateTriggers,
              getColor: crossColorUpdateTriggers,
              getMarkerColor: crossColorUpdateTriggers,
              getDirection: crossGeometryUpdateTriggers,
              getMarkerPlacements: crossGeometryUpdateTriggers
            },
            ...(settings.transitions
              ? {
                  transitions: {
                    getPath: TRACE_SPAN_POSITION_TRANSITION
                  }
                }
              : {}),
            widthUnits: 'pixels',
            mode: settings.lineRoutingMode === 'curve' ? 'arc' : 'line',
            getArcTilt: 90,
            getArcHeight: 0.3,
            pickable: true,
            autoHighlight: true,
            highlightColor: TRACE_COLOR.DEPENDENCY_HIGHLIGHT as [number, number, number, number],
            parameters: {
              blend: false,
              depthWriteEnabled: false,
              depthCompare: 'always'
            }
          }
        );

    const crossRankDependencySelectedLineLayer =
      new DependencyArrowLayer<TraceSelectedCrossProcessDependencySource>(
        this.getSubLayerProps({
          id: 'selected-lines',
          visible: visibleSelectedCrossProcessDependencies.length > 0
        }),
        {
          data: visibleSelectedCrossProcessDependencies,
          positionFormat: 'XY',
          getPath: (dependency: TraceSelectedCrossProcessDependencySource) =>
            getTraceLayoutSelectedCrossProcessDependencyGeometry({
              traceLayout,
              dependencyRef: dependency.dependencyRef,
              context: geometryContext
            }) ?? [],
          getColor: (dependency: TraceSelectedCrossProcessDependencySource) =>
            getSelectedCrossRankDependencyLineColor(
              dependency.waitTimeMs,
              dependency.selectedDirection
            ),
          getMarkerColor: (dependency: TraceSelectedCrossProcessDependencySource) =>
            getSelectedCrossRankDependencyLineColor(
              dependency.waitTimeMs,
              dependency.selectedDirection
            ),
          getMarkerSize: [2, 1],
          getWidth: SELECTED_CROSS_PROCESS_DEPENDENCY_LINE_WIDTH_PX,
          markerSizeScale:
            SELECTED_CROSS_PROCESS_DEPENDENCY_LINE_WIDTH_PX * PATH_DEPENDENCY_MARKER_SIZE,
          getMarkerPlacements: dependency =>
            dependency.bidirectional
              ? BIDIRECTIONAL_DEPENDENCY_MARKER_PLACEMENTS
              : FORWARD_DEPENDENCY_MARKER_PLACEMENTS,
          getDirection: dependency =>
            dependency.bidirectional ? PathDirection.BOTH : PathDirection.FORWARD,
          updateTriggers: {
            getPath: selectedGeometryUpdateTriggers,
            getColor: selectedColorUpdateTriggers,
            getMarkerColor: selectedColorUpdateTriggers
          },
          widthUnits: 'pixels',
          mode: settings.lineRoutingMode === 'curve' ? 'arc' : 'line',
          getArcTilt: 90,
          getArcHeight: 0.3,
          pickable: false,
          parameters: SELECTED_CROSS_PROCESS_DEPENDENCY_PARAMETERS
        }
      );

    return [crossRankDependencyLineLayer, crossRankDependencySelectedLineLayer];
  }
}
