import {CompositeLayer, log, type DefaultProps, type UpdateParameters} from '@deck.gl/core';
import {getBasemapLayers} from './globe-layers';
import {resolveBasemapStyle, type BasemapStyle, type ResolvedBasemapStyle} from './style-resolver';

/**
 * Logs a non-error basemap-layer runtime event to deck.gl logging.
 */
function logBasemapLayerEvent(message: string, details?: unknown): void {
  log.info(message, details ?? '')();
}

/**
 * Logs a basemap-layer runtime error to deck.gl logging.
 */
function logBasemapLayerError(message: string, error: Error): void {
  log.error(`${message}: ${error.message}`)();
}

/**
 * Globe-related runtime toggles used by {@link BasemapLayer}.
 */
export type BasemapGlobeConfig = {
  /** Renders the atmosphere overlays returned by the globe helpers when available. */
  atmosphere?: boolean;
  /** Renders the main globe basemap content when `true`. */
  basemap?: boolean;
  /** Enables symbol-label rendering on the globe path when `true`. */
  labels?: boolean;
};

/**
 * Props accepted by {@link BasemapLayer}.
 */
export type BasemapLayerProps = {
  /** Optional deck.gl layer identifier. */
  id?: string;
  /** MapLibre or Mapbox style JSON, or a URL that resolves to one. */
  style: string | BasemapStyle | null;
  /** Load options forwarded to {@link resolveBasemapStyle}. */
  loadOptions?: Record<string, unknown> | null;
  /** Selects whether deck layers are generated for a flat map or a globe. */
  mode?: 'map' | 'globe';
  /** Optional globe-specific configuration used when `mode` is `'globe'`. */
  globe?: {
    /** Rendering toggles for globe-specific basemap behavior. */
    config?: BasemapGlobeConfig;
  };
};

/**
 * Internal state tracked by {@link BasemapLayer}.
 */
type BasemapLayerState = {
  /** The fully resolved style definition currently backing the generated sublayers. */
  resolvedStyle: ResolvedBasemapStyle | null;
  /** The most recent style-resolution error, if one occurred. */
  loadError: Error | null;
  /** Monotonic token used to discard stale async style loads. */
  loadToken: number;
};

/**
 * A deck.gl {@link CompositeLayer} that loads a style document and renders the
 * corresponding basemap sublayers.
 */
export class BasemapLayer extends CompositeLayer<Required<BasemapLayerProps>> {
  /** Deck.gl layer name. */
  static layerName = 'BasemapLayer';

  /** Default props for {@link BasemapLayer}. */
  static defaultProps: DefaultProps<BasemapLayerProps> = {
    mode: 'map',
    globe: {
      type: 'object',
      value: {
        config: {
          atmosphere: false,
          basemap: true,
          labels: true
        }
      }
    },
    style: null,
    loadOptions: null
  };

  /** Current layer state. */
  state: BasemapLayerState = undefined!;

  /** Initializes the asynchronous style-loading state. */
  initializeState(): void {
    this.state = {
      resolvedStyle: null,
      loadError: null,
      loadToken: 0
    };
  }

  /** Reacts to changes in the input style definition. */
  updateState({props, oldProps, changeFlags}: UpdateParameters<this>): void {
    if (
      changeFlags.dataChanged ||
      props.style !== oldProps.style ||
      props.loadOptions !== oldProps.loadOptions
    ) {
      this.loadStyle(props.style, props.loadOptions);
    }
  }

  /**
   * Resolves the configured style input and stores the latest successful result
   * in layer state.
   */
  loadStyle(style: BasemapLayerProps['style'], loadOptions: BasemapLayerProps['loadOptions']): void {
    if (!style) {
      logBasemapLayerEvent('Clearing basemap style');
      this.setState({resolvedStyle: null, loadError: null});
      return;
    }

    const loadToken = this.state.loadToken + 1;
    this.setState({loadToken});
    logBasemapLayerEvent('Resolving basemap style', {
      style: typeof style === 'string' ? style : 'inline-style-object',
      loadToken
    });

    Promise.resolve(resolveBasemapStyle(style, loadOptions))
      .then(resolvedStyle => {
        if (this.state.loadToken === loadToken) {
          logBasemapLayerEvent('Resolved basemap style', {
            loadToken,
            sources: Object.keys(resolvedStyle.sources || {}),
            layers: resolvedStyle.layers?.length || 0
          });
          this.setState({resolvedStyle, loadError: null});
        }
      })
      .catch((error: Error) => {
        if (this.state.loadToken === loadToken) {
          logBasemapLayerError('Failed to resolve basemap style', error);
          this.setState({resolvedStyle: null, loadError: error});
        }
      });
  }

  /** Renders the sublayers generated from the resolved style definition. */
  renderLayers() {
    if (!this.state.resolvedStyle) {
      return [];
    }

    return getBasemapLayers({
      idPrefix: this.props.id,
      mode: this.props.mode,
      globe: this.props.globe,
      styleDefinition: this.state.resolvedStyle,
      zoom: this.context.viewport?.zoom || 0,
      loadOptions: this.props.loadOptions
    });
  }
}
