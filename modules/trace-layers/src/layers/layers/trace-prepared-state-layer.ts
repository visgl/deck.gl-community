import {CompositeLayer} from '@deck.gl/core';

import {
  DEFAULT_PATH_HIGHLIGHT_TRAIL_LENGTH,
  DEFAULT_TRACE_COLOR_SCHEME,
  DEFAULT_TRACE_FONT_FAMILY
} from '../../trace/index';
import {
  buildDeckBackgroundLayersForTrace,
  buildDeckLayerForCriticalPath,
  buildDeckLayersForInstantsAndCounter,
  buildDeckLayersForTrace
} from './deck-layers';

import type {
  TraceColorScheme,
  TracePathHighlightingResult,
  TraceViewState,
  TraceVisSettings
} from '../../trace/index';
import type {CompositeLayerProps, Layer, LayerProps} from '@deck.gl/core';
import type {TraceDeckLayerHandlers, TraceDeckLayerSelection} from './deck-layers';

const DEFAULT_TRACE_DECK_LAYER_HANDLERS: TraceDeckLayerHandlers = {
  onSpanClick: () => undefined
};

/** Path-animation overlays accepted by {@link TracePreparedStateLayer}. */
export type TracePreparedStateLayerPathHighlighting = Pick<
  TracePathHighlightingResult,
  'highlightedPathSpanRefs' | 'highlightedPathTrail' | 'pathHighlightTrailLength'
>;

/** Properties supported by {@link TracePreparedStateLayer}. */
export type TracePreparedStateLayerProps = LayerProps &
  CompositeLayerProps & {
    /** Prepared trace view state produced by `buildTraceViewState`. */
    readonly traceViewState: TraceViewState;
    /** Active visualization settings used by the trace deck sublayers. */
    readonly settings: TraceVisSettings;
    /** Transient hover, selection, and highlight overlays. */
    readonly selection?: TraceDeckLayerSelection;
    /** Interaction callbacks forwarded to interactive trace sublayers. */
    readonly handlers?: Partial<TraceDeckLayerHandlers>;
    /** Step number attached to process layers for legacy picking payloads. */
    readonly stepNum?: number;
    /** Active trace color scheme used by span, dependency, and path layers. */
    readonly colorScheme?: TraceColorScheme;
    /** CSS font stack used by trace text layers. */
    readonly fontFamily?: string;
    /** Whether dashed row separators should be rendered for foreground rows. */
    readonly showRowSeparators?: boolean;
    /** Active path animation overlays, when critical-path playback is enabled. */
    readonly pathHighlighting?: TracePreparedStateLayerPathHighlighting;
  };

/** Renders main-timeline trace deck layers from already-prepared trace view state. */
export class TracePreparedStateLayer extends CompositeLayer<TracePreparedStateLayerProps> {
  static override layerName = 'TracePreparedStateLayer';

  override renderLayers(): Layer[] {
    const {
      traceViewState,
      settings,
      selection,
      handlers: providedHandlers,
      stepNum = 0,
      colorScheme = DEFAULT_TRACE_COLOR_SCHEME,
      fontFamily = DEFAULT_TRACE_FONT_FAMILY,
      showRowSeparators = true,
      pathHighlighting
    } = this.props;
    const handlers = {
      ...DEFAULT_TRACE_DECK_LAYER_HANDLERS,
      ...providedHandlers
    } satisfies TraceDeckLayerHandlers;
    const pathHighlightTrailLength =
      pathHighlighting?.pathHighlightTrailLength ??
      Math.round(settings.criticalPathTrailSpanLength ?? DEFAULT_PATH_HIGHLIGHT_TRAIL_LENGTH);
    const mainTimelineEventSettings = settings.showGlobalEvents
      ? {...settings, showGlobalEvents: false}
      : settings;

    return traceViewState.preparedScene.foreground
      .flatMap(scene => [
        buildDeckBackgroundLayersForTrace({
          processRows: scene.layout.renderRows,
          traceLayout: scene.layout,
          layerIdPrefix: scene.layerIdPrefix,
          rankBackgroundColor: scene.rankBackgroundColor,
          modelMatrix: scene.modelMatrix
        }),
        ...buildDeckLayersForTrace({
          scene,
          stepNum,
          selection,
          settings,
          handlers,
          colorScheme,
          fontFamily,
          showRowSeparators
        }),
        ...buildDeckLayersForInstantsAndCounter({
          traceGraph: scene.graph,
          traceLayout: scene.layout,
          settings: mainTimelineEventSettings,
          colorScheme,
          layerIdPrefix: scene.layerIdPrefix,
          modelMatrix: scene.modelMatrix
        }),
        buildDeckLayerForCriticalPath({
          pathBlockSources: traceViewState.preparedScene.paths.pathBlockSources,
          pathDependencySources: traceViewState.preparedScene.paths.pathDependencySources,
          pathHighlightSpanRefs: pathHighlighting?.highlightedPathSpanRefs,
          pathHighlightTrail: pathHighlighting?.highlightedPathTrail,
          pathHighlightTrailLength,
          onSpanClick: handlers.onSpanClick,
          traceLayout: scene.layout,
          settings,
          colorScheme,
          highlightedSpanRefs: selection?.highlightedSpanRefs,
          layerIdPrefix: scene.layerIdPrefix,
          modelMatrix: scene.modelMatrix
        })
      ])
      .map(layer => this.getNamespacedSubLayer(layer));
  }

  /** Clones one helper-built layer under this composite layer's id namespace. */
  private getNamespacedSubLayer(layer: Layer): Layer {
    return layer.clone(this.getSubLayerProps({id: layer.id}));
  }
}
