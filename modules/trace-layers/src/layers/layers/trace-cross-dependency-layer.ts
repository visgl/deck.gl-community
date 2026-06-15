import {CompositeLayer, LayerProps} from '@deck.gl/core';
import {DependencyArrowLayer, PathDirection} from '@deck.gl-community/layers';

import {
  buildTraceLayoutGeometryDerivationContext,
  getCrossRankDependencyLineColor,
  getSelectedCrossRankDependencyLineColor,
  TRACE_COLOR,
  TraceColorScheme
} from '../../trace/index';
import {expandBounds, getCrossDependencyBounds} from './layer-bounds-utils';
import {
  applyDependencyLineOpacity,
  applyDependencyMarkerOpacity,
  getDependencyOpacityMultiplier,
  makeColorUpdateTriggers,
  makeGeometryUpdateTriggers,
  TRACE_SPAN_POSITION_TRANSITION
} from './trace-layer-utils';
import {
  getTraceLayoutCrossDependencyGeometry,
  getTraceLayoutSelectedCrossDependencyGeometry,
  getTraceLayoutSpanVisibilityBySpanRef
} from './trace-layout-geometry';

import type {
  TraceCrossDependencySource,
  TraceGraphSelectedCrossDependencySource,
  TraceLayout,
  TraceLayoutGeometryDerivationContext,
  TraceVisSettings,
  VisibleCrossDependencyRef
} from '../../trace/index';
import type {UpdateParameters} from '@deck.gl/core';

const CROSS_DEPENDENCY_LINE_WIDTH_PX = 1;
const CROSS_DEPENDENCY_OPACITY_MULTIPLIER = 0.75;
const SELECTED_CROSS_DEPENDENCY_LINE_WIDTH_PX = 2;
const PATH_DEPENDENCY_MARKER_SIZE = 3;
const FORWARD_DEPENDENCY_MARKER_PLACEMENTS = [1];
const BIDIRECTIONAL_DEPENDENCY_MARKER_PLACEMENTS = [1];
const SELECTED_CROSS_DEPENDENCY_PARAMETERS = {
  blend: false,
  depthTest: true,
  depthWriteEnabled: true,
  depthCompare: 'always'
} as const;
const EMPTY_SELECTED_CROSS_DEPENDENCIES: readonly TraceSelectedCrossDependencySource[] = [];
const EMPTY_LAYER_UPDATE_TRIGGER = {};
const EMPTY_LAYER_UPDATE_TRIGGERS = [EMPTY_LAYER_UPDATE_TRIGGER];

type TraceSelectedCrossDependencySource =
  | (TraceCrossDependencySource & {
      /** Exact visible dependency ref used for selected-overlay geometry. */
      dependencyRef: VisibleCrossDependencyRef;
      /** Optional legacy selected-dependency direction; missing values render as incoming. */
      selectedDirection?: TraceGraphSelectedCrossDependencySource['selectedDirection'];
    })
  | (TraceGraphSelectedCrossDependencySource & {
      /** Exact visible dependency ref used for selected-overlay geometry. */
      dependencyRef: TraceGraphSelectedCrossDependencySource['dependencyRef'];
    });

type TraceCrossDependencyLayerState = {
  /** Selected cross-process dependency sources that carry exact visible dependency refs. */
  visibleSelectedCrossDependencies: readonly TraceSelectedCrossDependencySource[];
};

/**
 * Returns true when two selected cross dependencies produce the same selected-overlay geometry and
 * styling.
 */
function areSameSelectedCrossDependency(
  previous: TraceSelectedCrossDependencySource,
  next: TraceSelectedCrossDependencySource
): boolean {
  return (
    previous.dependencyRef === next.dependencyRef &&
    previous.selectedDirection === next.selectedDirection &&
    previous.waitTimeMs === next.waitTimeMs &&
    previous.bidirectional === next.bidirectional
  );
}

/** Returns true when two selected cross dependency arrays are equivalent for deck attributes. */
function areSameSelectedCrossDependencies(
  previous: readonly TraceSelectedCrossDependencySource[],
  next: readonly TraceSelectedCrossDependencySource[]
): boolean {
  return (
    previous.length === next.length &&
    previous.every((dependency, index) =>
      areSameSelectedCrossDependency(dependency, next[index] as TraceSelectedCrossDependencySource)
    )
  );
}

/** Narrows cross dependency sources to entries that carry visible dependency refs. */
function hasVisibleCrossDependencyRef(
  dependency: TraceCrossDependencySource | TraceGraphSelectedCrossDependencySource
): dependency is TraceSelectedCrossDependencySource {
  return dependency.dependencyRef != null;
}

/** Returns selected cross dependencies, preserving the original array when every item is visible. */
function getVisibleCrossDependencyRefs(
  dependencies: Readonly<
    Array<TraceCrossDependencySource | TraceGraphSelectedCrossDependencySource>
  >
): readonly TraceSelectedCrossDependencySource[] {
  if (dependencies.every(hasVisibleCrossDependencyRef)) {
    return dependencies as readonly TraceSelectedCrossDependencySource[];
  }
  return dependencies.filter(hasVisibleCrossDependencyRef);
}

/** Returns the base color for a cross dependency, including hidden-endpoint styling. */
function getCrossDependencyBaseLineColor(
  traceLayout: Readonly<TraceLayout>,
  dependency: TraceCrossDependencySource,
  settings: TraceVisSettings,
  context: TraceLayoutGeometryDerivationContext
) {
  return hasHiddenCrossDependencyEndpoint(traceLayout, dependency, context)
    ? TRACE_COLOR.CROSS_DEPENDENCY_HIDDEN_ENDPOINT_LINE
    : getCrossRankDependencyLineColor(dependency, settings);
}

/** Returns true when either endpoint span is layout-hidden for the current view. */
function hasHiddenCrossDependencyEndpoint(
  traceLayout: Readonly<TraceLayout>,
  dependency: TraceCrossDependencySource,
  context: TraceLayoutGeometryDerivationContext
): boolean {
  const startVisibility =
    dependency.startSpanRef != null
      ? getTraceLayoutSpanVisibilityBySpanRef({
          traceLayout,
          spanRef: dependency.startSpanRef,
          context
        })
      : undefined;
  const endVisibility =
    dependency.endSpanRef != null
      ? getTraceLayoutSpanVisibilityBySpanRef({
          traceLayout,
          spanRef: dependency.endSpanRef,
          context
        })
      : undefined;
  return startVisibility?.visible === false || endVisibility?.visible === false;
}

/**
 * Composite layer that renders cross-rank dependencies.
 *
 * Sublayer identifiers:
 * - `${id}-lines`: all cross-rank dependency polylines.
 * - `${id}-selected-lines`: highlighted selection overlay.
 */
export type TraceCrossDependencyLayerProps = LayerProps & {
  colorScheme?: TraceColorScheme;
  crossDependencies: Readonly<TraceCrossDependencySource[]>;
  /** Selected dependency sources before layer state narrows them to visible dependency refs. */
  selectedCrossDependencies: Readonly<
    Array<TraceCrossDependencySource | TraceGraphSelectedCrossDependencySource>
  >;
  settings: TraceVisSettings;
  traceLayout: Readonly<TraceLayout>;
};

export class TraceCrossDependencyLayer extends CompositeLayer<TraceCrossDependencyLayerProps> {
  static layerName = 'TraceCrossDependencyLayer';

  static defaultProps: Required<Omit<TraceCrossDependencyLayerProps, keyof LayerProps>> = {
    crossDependencies: [],
    selectedCrossDependencies: [],
    colorScheme: undefined!,
    settings: undefined!,
    traceLayout: undefined!
  };

  override updateState({props, oldProps}: UpdateParameters<this>) {
    const previousVisibleSelectedCrossDependencies =
      (this.state as Partial<TraceCrossDependencyLayerState>).visibleSelectedCrossDependencies ??
      EMPTY_SELECTED_CROSS_DEPENDENCIES;

    if (
      props.selectedCrossDependencies === oldProps.selectedCrossDependencies &&
      previousVisibleSelectedCrossDependencies.length > 0
    ) {
      return;
    }

    const nextVisibleSelectedCrossDependencies = getVisibleCrossDependencyRefs(
      props.selectedCrossDependencies
    );
    if (
      areSameSelectedCrossDependencies(
        previousVisibleSelectedCrossDependencies,
        nextVisibleSelectedCrossDependencies
      )
    ) {
      return;
    }

    this.setState({
      visibleSelectedCrossDependencies: nextVisibleSelectedCrossDependencies
    } satisfies TraceCrossDependencyLayerState);
  }

  /** Initializes derived state for direct renderLayers calls outside deck.gl's lifecycle. */
  private ensureDerivedState() {
    if (this.state) {
      return;
    }

    this.state = {};
    this.updateState({
      props: this.props,
      oldProps: {} as TraceCrossDependencyLayerProps
    } as UpdateParameters<this>);
  }

  override getBounds() {
    this.ensureDerivedState();
    const {traceLayout, crossDependencies} = this.props;
    const {visibleSelectedCrossDependencies = EMPTY_SELECTED_CROSS_DEPENDENCIES} = this
      .state as Partial<TraceCrossDependencyLayerState>;
    return expandBounds(
      getCrossDependencyBounds(
        [...crossDependencies, ...visibleSelectedCrossDependencies],
        traceLayout
      )
    );
  }

  renderLayers() {
    this.ensureDerivedState();
    const {crossDependencies, settings, traceLayout} = this.props;
    const {visibleSelectedCrossDependencies = EMPTY_SELECTED_CROSS_DEPENDENCIES} = this
      .state as Partial<TraceCrossDependencyLayerState>;

    const geometryUpdateTriggers = makeGeometryUpdateTriggers(settings, traceLayout);
    const colorUpdateTriggers = makeColorUpdateTriggers(settings);
    const crossGeometryUpdateTriggers =
      crossDependencies.length > 0 ? geometryUpdateTriggers : EMPTY_LAYER_UPDATE_TRIGGERS;
    const crossColorUpdateTriggers =
      crossDependencies.length > 0
        ? [...colorUpdateTriggers, traceLayout]
        : EMPTY_LAYER_UPDATE_TRIGGERS;
    const selectedGeometryUpdateTriggers =
      visibleSelectedCrossDependencies.length > 0
        ? geometryUpdateTriggers
        : EMPTY_LAYER_UPDATE_TRIGGERS;
    const selectedColorUpdateTriggers =
      visibleSelectedCrossDependencies.length > 0
        ? colorUpdateTriggers
        : EMPTY_LAYER_UPDATE_TRIGGERS;
    const dependencyOpacityMultiplier =
      getDependencyOpacityMultiplier(settings) * CROSS_DEPENDENCY_OPACITY_MULTIPLIER;
    const geometryContext = buildTraceLayoutGeometryDerivationContext(traceLayout);

    const crossRankDependencyLineLayer = new DependencyArrowLayer<TraceCrossDependencySource>(
      this.getSubLayerProps({
        id: 'lines',
        visible: settings.showCrossProcessDependencies && crossDependencies.length > 0
      }),
      {
        data: crossDependencies,
        positionFormat: 'XY',
        getPath: (dependency: TraceCrossDependencySource) =>
          getTraceLayoutCrossDependencyGeometry({
            traceLayout,
            dependency,
            context: geometryContext
          }) ?? [],
        getColor: (dependency: TraceCrossDependencySource) =>
          applyDependencyLineOpacity(
            getCrossDependencyBaseLineColor(traceLayout, dependency, settings, geometryContext),
            dependencyOpacityMultiplier
          ),
        getMarkerColor: (dependency: TraceCrossDependencySource) =>
          applyDependencyMarkerOpacity(
            getCrossDependencyBaseLineColor(traceLayout, dependency, settings, geometryContext),
            dependencyOpacityMultiplier
          ),
        getWidth: CROSS_DEPENDENCY_LINE_WIDTH_PX,
        getMarkerSize: [2, 1],
        markerSizeScale: CROSS_DEPENDENCY_LINE_WIDTH_PX * PATH_DEPENDENCY_MARKER_SIZE,
        getMarkerPlacements: dependency =>
          dependency.bidirectional
            ? BIDIRECTIONAL_DEPENDENCY_MARKER_PLACEMENTS
            : FORWARD_DEPENDENCY_MARKER_PLACEMENTS,
        getDirection: dependency =>
          dependency.bidirectional ? PathDirection.BOTH : PathDirection.FORWARD,
        updateTriggers: {
          getPath: crossGeometryUpdateTriggers,
          getColor: crossColorUpdateTriggers,
          getMarkerColor: crossColorUpdateTriggers
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
      new DependencyArrowLayer<TraceSelectedCrossDependencySource>(
        this.getSubLayerProps({
          id: 'selected-lines',
          visible: visibleSelectedCrossDependencies.length > 0
        }),
        {
          data: visibleSelectedCrossDependencies,
          positionFormat: 'XY',
          getPath: (dependency: TraceSelectedCrossDependencySource) =>
            getTraceLayoutSelectedCrossDependencyGeometry({
              traceLayout,
              dependencyRef: dependency.dependencyRef,
              context: geometryContext
            }) ?? [],
          getColor: (dependency: TraceSelectedCrossDependencySource) =>
            getSelectedCrossRankDependencyLineColor(
              dependency.waitTimeMs,
              dependency.selectedDirection
            ),
          getMarkerColor: (dependency: TraceSelectedCrossDependencySource) =>
            getSelectedCrossRankDependencyLineColor(
              dependency.waitTimeMs,
              dependency.selectedDirection
            ),
          getMarkerSize: [2, 1],
          getWidth: SELECTED_CROSS_DEPENDENCY_LINE_WIDTH_PX,
          markerSizeScale: SELECTED_CROSS_DEPENDENCY_LINE_WIDTH_PX * PATH_DEPENDENCY_MARKER_SIZE,
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
          parameters: SELECTED_CROSS_DEPENDENCY_PARAMETERS
        }
      );

    return [crossRankDependencyLineLayer, crossRankDependencySelectedLineLayer];
  }
}
