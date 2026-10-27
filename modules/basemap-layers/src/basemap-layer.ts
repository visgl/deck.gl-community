import {isGlobeViewport, SharedMVTLayer, SharedTileset2D} from '@deck.gl-community/geo-layers';
import type {BasemapSource} from './style-resolver';
import {
  CompositeLayer,
  log,
  type DefaultProps,
  type UpdateParameters,
  type Viewport
} from '@deck.gl/core';
import {load} from '@loaders.gl/core';
import {
  createDemTileset,
  getBasemapLayers,
  getSourceLoadOptions,
  getStyleDefinitionZoomLimits,
  getStyleSourceLayers,
  getTilePyramidProps,
  getVectorTileLoader,
  isVectorTileSource,
  VECTOR_TILE_ZOOM_OFFSET
} from './globe-layers';
import {
  acquireSharedLabelPlacement,
  DEFAULT_PLACEMENT_INTERVAL,
  getSharedLabelPlacementKey,
  LabelPlacement,
  releaseSharedLabelPlacement
} from './label-placement';
import {MapStyleLoader, type MapStyleLoaderOptions} from './map-style-loader';
import {getDemUnpackVector} from './hillshade-layer';
import {getStyleZoomKey} from './style-accessor';
import type {BasemapStyle, ResolvedBasemapStyle} from './style-resolver';
import {GlyphStore} from './glyph-store';
import {loadSpriteAtlases} from './sprite';
import type {SpriteAtlas} from './sprite';
import type {LabelFontFamily} from './text-font';

/**
 * Logs a non-error basemap-layer runtime event to deck.gl logging.
 */
function logBasemapLayerEvent(message: string, details?: unknown): void {
  log.probe(1, message, details ?? '')();
}

/**
 * Logs a basemap-layer runtime error to deck.gl logging.
 */
function logBasemapLayerError(message: string, error: Error): void {
  log.error(`${message}: ${error.message}`)();
}

function getMapStyleLoaderOptions(
  loadOptions: BasemapLayerProps['loadOptions']
): MapStyleLoaderOptions {
  return {
    mapStyle: (loadOptions || undefined) as NonNullable<MapStyleLoaderOptions['mapStyle']>
  };
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
  /**
   * Draws labels with the browser's fonts instead of the style's `glyphs`. By default labels are
   * drawn with the style's glyphs, as in MapLibre GL JS, and a style without `glyphs` maps each
   * symbol layer's `text-font` to a CSS family list, weight and style (see the module docs). A
   * string replaces the family list for every label; a function receives the `text-font` names
   * and returns a family list or `LabelFont` fields. Pass a stable function: tiles regenerate when
   * it changes.
   */
  fontFamily?: LabelFontFamily | null;
  /**
   * Milliseconds between two placements of the labels while the view keeps changing, as MapLibre
   * GL JS's `fadeDuration` (default 300). The view the map comes to rest in is always placed; 0
   * places every frame.
   */
  labelPlacementInterval?: number;
  /**
   * Places this layer's labels apart from those of the other `BasemapLayer`s of the deck. By
   * default (`false`) the labels of every `BasemapLayer` in a deck are placed together, as the
   * layers of one style: a label hides those it overlaps, and those of a `BasemapLayer` drawn later
   * are placed first. With `true`, this layer's labels collide only with each other.
   */
  separateLabelPlacement?: boolean;
};

const fractionalZoomLimitsCache = new WeakMap<ResolvedBasemapStyle, number[]>();

/**
 * The fractional `minzoom`/`maxzoom` limits of a style, computed once per resolved style:
 * `shouldUpdateState` reads them on every viewport change, but they only change with the style.
 */
function getFractionalZoomLimits(resolvedStyle: ResolvedBasemapStyle): number[] {
  let limits = fractionalZoomLimitsCache.get(resolvedStyle);
  if (!limits) {
    limits = getStyleDefinitionZoomLimits(resolvedStyle).filter(
      (limit): limit is number => limit !== undefined && !Number.isInteger(limit)
    );
    fractionalZoomLimitsCache.set(resolvedStyle, limits);
  }
  return limits;
}

/**
 * Internal state tracked by {@link BasemapLayer}.
 */
type BasemapLayerState = {
  /**
   * Places the labels of every symbol style layer together (see `LabelPlacement`): the deck's
   * shared placement, or this layer's own with `separateLabelPlacement`.
   */
  labelPlacement: LabelPlacement | null;
  /** The deck whose shared placement `labelPlacement` is, or null for a placement of its own. */
  sharedLabelPlacementKey: object | null;
  /** The fully resolved style definition currently backing the generated sublayers. */
  resolvedStyle: ResolvedBasemapStyle | null;
  /** The most recent style-resolution error, if one occurred. */
  loadError: Error | null;
  /** Monotonic token used to discard stale async style loads. */
  loadToken: number;
  /** `getStyleZoomKey` of the zoom the current sublayers were generated at. */
  zoomKey: string | null;
  /** Sprites of the resolved style, once loaded. */
  spriteAtlases: SpriteAtlas[] | null;
  /** The glyphs of the resolved style's `glyphs` URL, or null without one. */
  glyphs: GlyphStore | null;
  /** Decoded data caches owned by this basemap, shared across style runs. */
  tilesets: Map<BasemapSource, SharedTileset2D>;
  /**
   * What each tileset decodes: for a vector source its source layers, as JSON (see
   * `getStyleSourceLayers`), for a raster-dem source its encoding.
   */
  tilesetSourceLayers: Map<BasemapSource, string>;
  /** Loading configuration used to construct the current source caches. */
  tileLoadOptions: unknown;
  /** Fetch identity, kept separate from render-only props such as view mode. */
  tileFetch: unknown;
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
    loadOptions: null,
    fontFamily: null,
    labelPlacementInterval: DEFAULT_PLACEMENT_INTERVAL,
    separateLabelPlacement: false
  };

  /** Current layer state. */
  state: BasemapLayerState = undefined!;

  /** Initializes the asynchronous style-loading state. */
  initializeState(): void {
    this.state = {
      labelPlacement: null,
      sharedLabelPlacementKey: null,
      resolvedStyle: null,
      loadError: null,
      loadToken: 0,
      zoomKey: null,
      tilesets: new Map(),
      tilesetSourceLayers: new Map(),
      tileLoadOptions: null,
      tileFetch: null,
      spriteAtlases: null,
      glyphs: null
    };
  }

  /**
   * Sublayers depend on the zoom, but only through `getStyleZoomKey`: style values step every
   * `STYLE_ZOOM_STEP`, filters at integer zooms, and layer visibility changes at
   * `minzoom`/`maxzoom`. Re-render when that key changes, not on every viewport change.
   */
  shouldUpdateState(params: UpdateParameters<this>): boolean {
    if (super.shouldUpdateState(params)) {
      return true;
    }
    const {resolvedStyle, zoomKey} = this.state;
    if (!resolvedStyle || !params.changeFlags.viewportChanged) {
      return false;
    }
    return this.getZoomKey(resolvedStyle, params.context.viewport) !== zoomKey;
  }

  /** Returns the key of what the sublayers depend on in `viewport`, for a resolved style. */
  getZoomKey(resolvedStyle: ResolvedBasemapStyle, viewport: Viewport | undefined): string {
    const zoomKey = getStyleZoomKey(viewport?.zoom || 0, getFractionalZoomLimits(resolvedStyle));
    return `${this.getDrawMode(viewport)}:${zoomKey}`;
  }

  /**
   * The mode the sublayers are drawn in. Above zoom 12, `GlobeView` draws with a Web Mercator
   * viewport, so a globe basemap draws as a map there: globe depth and culling parameters assume
   * longitude/latitude geometry on a sphere.
   */
  getDrawMode(viewport: Viewport | undefined): 'map' | 'globe' {
    const {mode = 'map'} = this.props;
    return mode === 'globe' && viewport && !isGlobeViewport(viewport) ? 'map' : mode;
  }

  /** Reacts to changes in the input style definition. */
  updateState({props, oldProps, changeFlags}: UpdateParameters<this>): void {
    this.updateLabelPlacement();
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
  loadStyle(
    style: BasemapLayerProps['style'],
    loadOptions: BasemapLayerProps['loadOptions']
  ): void {
    if (!style) {
      const loadToken = this.state.loadToken + 1;
      logBasemapLayerEvent('Clearing basemap style');
      this.clearSourceTilesets();
      this.setState({
        resolvedStyle: null,
        loadError: null,
        loadToken,
        spriteAtlases: null,
        glyphs: null
      });
      return;
    }

    const loadToken = this.state.loadToken + 1;
    this.setState({loadToken});
    logBasemapLayerEvent('Resolving basemap style', {
      style: typeof style === 'string' ? style : 'inline-style-object',
      loadToken
    });

    Promise.resolve(
      typeof style === 'string'
        ? load(style, MapStyleLoader, getMapStyleLoaderOptions(loadOptions))
        : MapStyleLoader.parse(
            new TextEncoder().encode(JSON.stringify(style)).buffer,
            getMapStyleLoaderOptions(loadOptions)
          )
    )
      .then(resolvedStyle => {
        if (this.state.loadToken === loadToken) {
          logBasemapLayerEvent('Resolved basemap style', {
            loadToken,
            sources: Object.keys(resolvedStyle.sources || {}),
            layers: resolvedStyle.layers?.length || 0
          });
          this.setState({
            resolvedStyle,
            loadError: null,
            spriteAtlases: null,
            glyphs: getGlyphStore(resolvedStyle, style, loadOptions)
          });
          this.loadSprites(resolvedStyle, style, loadOptions, loadToken);
        }
      })
      .catch((error: Error) => {
        if (this.state.loadToken === loadToken) {
          logBasemapLayerError('Failed to resolve basemap style', error);
          this.clearSourceTilesets();
          this.setState({resolvedStyle: null, loadError: error});
        }
      });
  }

  /**
   * Loads the resolved style's sprites, if it has any, and stores them for the icon layers.
   * Relative sprite URLs resolve against the style URL.
   */
  loadSprites(
    resolvedStyle: ResolvedBasemapStyle,
    style: BasemapLayerProps['style'],
    loadOptions: BasemapLayerProps['loadOptions'],
    loadToken: number
  ): void {
    if (!resolvedStyle.sprite) {
      // No sprites to wait for (`null` means loading, see `MVTLabelLayerProps.spriteAtlases`).
      this.setState({spriteAtlases: []});
      return;
    }
    const options = (loadOptions || {}) as {
      baseUrl?: string;
      fetch?: typeof fetch;
      fetchOptions?: RequestInit;
    };
    loadSpriteAtlases(resolvedStyle.sprite, {
      baseUrl: typeof style === 'string' ? style : options.baseUrl,
      fetch: options.fetch,
      fetchOptions: options.fetchOptions,
      pixelRatio: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
    }).then(spriteAtlases => {
      if (this.state.loadToken === loadToken) {
        this.setState({spriteAtlases});
      }
    });
  }

  /** The basemap owns caches; style-run consumers only attach/detach. */
  finalizeState(): void {
    this.state.loadToken++;
    this.clearSourceTilesets();
    this.releaseLabelPlacement();
  }

  /**
   * Takes the deck's shared label placement, or one of its own with `separateLabelPlacement`, and
   * gives back the one it had when that prop changed.
   */
  private updateLabelPlacement(): void {
    const separate = Boolean(this.props.separateLabelPlacement);
    const {labelPlacement, sharedLabelPlacementKey} = this.state;
    if (labelPlacement && separate === !sharedLabelPlacementKey) {
      return;
    }
    this.releaseLabelPlacement();
    if (separate) {
      this.state.labelPlacement = new LabelPlacement();
    } else {
      const key = getSharedLabelPlacementKey(this);
      this.state.sharedLabelPlacementKey = key;
      this.state.labelPlacement = acquireSharedLabelPlacement(key);
    }
  }

  /** Gives back the deck's shared placement, or releases this layer's own. */
  private releaseLabelPlacement(): void {
    const {labelPlacement, sharedLabelPlacementKey} = this.state;
    if (sharedLabelPlacementKey) {
      releaseSharedLabelPlacement(sharedLabelPlacementKey);
    } else {
      labelPlacement?.destroy();
    }
    this.state.labelPlacement = null;
    this.state.sharedLabelPlacementKey = null;
  }

  private clearSourceTilesets(): void {
    for (const tileset of this.state.tilesets.values()) tileset.finalize();
    this.state.tilesets.clear();
    this.state.tilesetSourceLayers.clear();
  }

  private updateSourceTilesets(style: ResolvedBasemapStyle): void {
    const sources = new Set(
      Object.values(style.sources || {}).filter(source => isVectorTileSource(source))
    );
    // The decoded tiles of a raster-dem source are shared by its hillshade layers.
    const demSources = new Set(
      Object.values(style.sources || {}).filter(
        source => source?.type === 'raster-dem' && source.tiles
      )
    );
    const optionsChanged =
      this.state.tileLoadOptions !== this.props.loadOptions ||
      this.state.tileFetch !== this.props.fetch;
    // Tiles decode only the source layers the style draws: a style edit or a labels toggle that
    // changes the layers the loader decodes reloads the source's tiles.
    const sourceLayers = getStyleSourceLayers(style, this.props.globe);
    const getDecodedLayers = (source: BasemapSource) =>
      (getSourceLoadOptions(this.props.loadOptions, sourceLayers.get(source)) as any)?.mvt?.layers;
    const sourceLayerKeys = new Map([
      ...[...sources].map(
        source => [source, JSON.stringify(getDecodedLayers(source) ?? null)] as const
      ),
      // An encoding edited in place reloads the source's tiles.
      ...[...demSources].map(source => [source, `dem:${getDemUnpackVector(source)}`] as const)
    ]);
    for (const [source, tileset] of this.state.tilesets) {
      if (
        !sourceLayerKeys.has(source) ||
        optionsChanged ||
        this.state.tilesetSourceLayers.get(source) !== sourceLayerKeys.get(source)
      ) {
        tileset.finalize();
        this.state.tilesets.delete(source);
        this.state.tilesetSourceLayers.delete(source);
      }
    }
    this.state.tileLoadOptions = this.props.loadOptions;
    this.state.tileFetch = this.props.fetch;
    for (const source of sources) {
      if (!this.state.tilesets.has(source)) {
        const loader = new SharedMVTLayer({
          id: `${this.id}-loader`,
          data: source.tiles!,
          fetch: this.props.fetch,
          loadOptions: getSourceLoadOptions(this.props.loadOptions, sourceLayers.get(source))
        });
        loader.context = this.context;
        const tileset = new SharedTileset2D({
          ...loader._getTilesetOptions(),
          ...getTilePyramidProps(source),
          tileSize: source.tileSize || 512,
          zoomOffset: VECTOR_TILE_ZOOM_OFFSET,
          getTileData: getVectorTileLoader(source, loader)
        });
        this.state.tilesets.set(source, tileset);
        this.state.tilesetSourceLayers.set(source, sourceLayerKeys.get(source)!);
      }
    }
    for (const source of demSources) {
      if (!this.state.tilesets.has(source)) {
        const tileset = createDemTileset(source, this.props.loadOptions);
        this.state.tilesets.set(source, tileset);
        this.state.tilesetSourceLayers.set(source, sourceLayerKeys.get(source)!);
      }
    }
  }

  /** The label placement, with the interval of the current props. */
  private getLabelPlacement(): LabelPlacement {
    this.updateLabelPlacement();
    const labelPlacement = this.state.labelPlacement!;
    // A shared placement takes the interval of the last of its layers rendered.
    labelPlacement.interval = Math.max(0, Number(this.props.labelPlacementInterval) || 0);
    return labelPlacement;
  }

  /** Renders the sublayers generated from the resolved style definition. */
  renderLayers() {
    const {resolvedStyle} = this.state;
    if (!resolvedStyle) {
      return [];
    }

    this.updateSourceTilesets(resolvedStyle);
    const {viewport} = this.context;
    const zoom = viewport?.zoom || 0;
    // Recorded without setState: this only tracks what the current sublayers were built from.
    this.state.zoomKey = this.getZoomKey(resolvedStyle, viewport);

    return getBasemapLayers({
      idPrefix: this.props.id,
      mode: this.getDrawMode(viewport),
      globe: this.props.globe,
      styleDefinition: resolvedStyle,
      zoom,
      loadOptions: this.props.loadOptions,
      spriteAtlases: this.state.spriteAtlases,
      fontFamily: this.props.fontFamily,
      // A label font of the caller's is drawn with the browser's fonts.
      glyphs: this.props.fontFamily ? null : this.state.glyphs,
      labelPlacement: this.getLabelPlacement(),
      tilesets: this.state.tilesets
    });
  }
}

/**
 * The glyph store of a style's `glyphs` URL, or null without one. A relative URL resolves against
 * the style URL, as sprite URLs do.
 */
function getGlyphStore(
  resolvedStyle: ResolvedBasemapStyle,
  style: BasemapLayerProps['style'],
  loadOptions: BasemapLayerProps['loadOptions']
): GlyphStore | null {
  const url = resolvedStyle.glyphs;
  if (typeof url !== 'string' || !url) {
    return null;
  }
  const options = (loadOptions || {}) as {
    baseUrl?: string;
    fetch?: typeof fetch;
    fetchOptions?: RequestInit;
  };
  return new GlyphStore({
    url,
    baseUrl: typeof style === 'string' ? style : options.baseUrl,
    fetch: options.fetch,
    fetchOptions: options.fetchOptions
  });
}
