import {COORDINATE_SYSTEM, log} from '@deck.gl/core';
import {MVTLayer, TileLayer, _getURLFromTemplate} from '@deck.gl/geo-layers';
import {BitmapLayer, GeoJsonLayer, SolidPolygonLayer} from '@deck.gl/layers';
import {MVTWorkerLoader} from '@loaders.gl/mvt';
import {getGlobeAtmosphereLayer, getGlobeAtmosphereSkyLayer} from './atmosphere-layer';
import {MVTLabelLayer} from './mvt-label-layer';
import {filterFeatures, parseProperties} from './map-style';
import {
  getFilterZoom,
  getStyleAccessor,
  getStyleZoomKey,
  getZoomBucket,
  withOpacity
} from './style-accessor';
import type {BasemapGlobeConfig, BasemapLayerProps} from './basemap-layer';
import type {SpriteAtlas} from './sprite';
import type {
  BasemapLoadOptions,
  BasemapSource,
  ResolvedBasemapStyleLayer as BasemapStyleLayer,
  ResolvedBasemapStyle
} from './style-resolver';

type BasemapMode = NonNullable<BasemapLayerProps['mode']>;

type BasemapLayerConfig = {
  atmosphere: boolean;
  basemap: boolean;
  labels: boolean;
};

type BasemapLayerGroup = {
  idPrefix?: string;
  mode?: BasemapMode;
  globe?: {config?: BasemapGlobeConfig};
  styleDefinition: ResolvedBasemapStyle;
  zoom?: number;
  loadOptions?: BasemapLoadOptions;
  /** Sprites loaded for the style; symbol layers draw `icon-image` from them. */
  spriteAtlases?: SpriteAtlas[] | null;
};

type VectorSourceGroup = {
  sourceId: string;
  source: BasemapSource;
  styleLayers: BasemapStyleLayer[];
};

function logBasemapRuntimeEvent(message: string, details?: unknown): void {
  log.probe(1, `[BasemapLayer] ${message}`, details ?? '')();
}

function logBasemapRuntimeError(message: string, error: unknown, details?: unknown): void {
  log.error(`[BasemapLayer] ${message}`, details || '', error)();
}

function getBackgroundParameters(mode: BasemapMode) {
  return (
    mode === 'globe'
      ? {depthTest: true, depthWriteEnabled: true, depthCompare: 'less-equal', cullMode: 'back'}
      : {depthTest: false, cullMode: 'none'}
  ) as any;
}

function getTileParameters(mode: BasemapMode) {
  return (
    mode === 'globe'
      ? {depthTest: true, depthWriteEnabled: true, depthCompare: 'less-equal', cullMode: 'back'}
      : {depthTest: false, cullMode: 'none'}
  ) as any;
}

const BACKGROUND_DATA = [
  [
    [-180, 90],
    [0, 90],
    [180, 90],
    [180, -90],
    [0, -90],
    [-180, -90]
  ]
];

const BACKGROUND_NORTH_POLE_DATA = [
  [
    [-180, 90],
    [0, 90],
    [180, 90],
    [180, 85],
    [0, 85],
    [-180, 85]
  ]
];

const SUPPORTED_TYPES = new Set(['background', 'fill', 'line', 'symbol', 'raster']);
const DEFAULT_CONFIG: BasemapLayerConfig = {atmosphere: false, basemap: true, labels: true};
const DEFAULT_TEXT_COLOR = [0, 0, 0, 1];

/** The latest evaluated paint per style layer, reused across tiles within one zoom step. */
const paintCache = new WeakMap<
  BasemapStyleLayer,
  {zoomBucket: number; paint: Record<string, any>}
>();

/**
 * Evaluates a style layer's paint at the stepped zoom (see `getZoomBucket`). Every tile
 * regenerated at one step gets the same result, so it is computed once per style layer and step.
 */
function getPaint(layer: BasemapStyleLayer, zoom: number): Record<string, any> {
  const zoomBucket = getZoomBucket(zoom);
  const cached = paintCache.get(layer);
  if (cached && cached.zoomBucket === zoomBucket) {
    return cached.paint;
  }
  const properties = parseProperties(layer, {zoom: zoomBucket});
  const paint = Object.fromEntries(
    properties.map(entry => [Object.keys(entry)[0], Object.values(entry)[0]])
  );
  paintCache.set(layer, {zoomBucket, paint});
  return paint;
}

type FilteredFeatures = {
  /** The filter's contents when the entry was made, so an in-place edit is detected. */
  filterSnapshot: string;
  sourceLayer: string | undefined;
  filterZoom: number | null;
  features: any[];
};

/**
 * The latest filtered features per tile content and style layer. Tile sublayers regenerate at
 * every style zoom step; handing them the same array keeps deck.gl from seeing a data change, so
 * only zoom-dependent accessors recompute instead of every feature being re-tessellated. The
 * entry is reused while the contents of the style layer's `filter`, its `source-layer` and (for
 * filters that read `["zoom"]`) the integer zoom are unchanged, so a filter edited in place is
 * re-applied, as `compileStyleFilter` recompiles it.
 */
const filteredFeatureCache = new WeakMap<any[], WeakMap<BasemapStyleLayer, FilteredFeatures>>();

function filterTileFeatures(features: any[], styleLayer: BasemapStyleLayer, zoom: number): any[] {
  const sourceLayer = styleLayer['source-layer'];
  const {filter} = styleLayer;
  if (!sourceLayer && !filter) {
    return features;
  }

  const filterSnapshot = filter === undefined ? '' : JSON.stringify(filter);
  // MapLibre evaluates `["zoom"]` in filters at integer zooms.
  const filterZoom = filterSnapshot.includes('["zoom"]') ? getFilterZoom(zoom) : null;
  let byStyleLayer = filteredFeatureCache.get(features);
  if (!byStyleLayer) {
    byStyleLayer = new WeakMap();
    filteredFeatureCache.set(features, byStyleLayer);
  }
  const cached = byStyleLayer.get(styleLayer);
  if (
    cached &&
    cached.filterSnapshot === filterSnapshot &&
    cached.sourceLayer === sourceLayer &&
    cached.filterZoom === filterZoom
  ) {
    return cached.features;
  }

  const sourceFeatures = sourceLayer
    ? features.filter(feature => feature.properties?.layerName === sourceLayer)
    : features;
  const filtered = filter
    ? filterFeatures({
        features: sourceFeatures,
        filter: filter as unknown[],
        globalProperties: {zoom: getFilterZoom(zoom)}
      })
    : sourceFeatures;
  byStyleLayer.set(styleLayer, {filterSnapshot, sourceLayer, filterZoom, features: filtered});
  return filtered;
}

/** The `minzoom`/`maxzoom` limits that `isStyleLayerVisibleAtZoom` compares against. */
export function getStyleZoomLimits(styleLayers: BasemapStyleLayer[]): (number | undefined)[] {
  return styleLayers.flatMap(layer => [layer.minzoom, layer.maxzoom]);
}

/**
 * A style layer is visible within its own `minzoom`/`maxzoom` only, as in MapLibre. A source's
 * `maxzoom` limits which tiles exist, not which layers draw: past it, the tile layer overzooms.
 */
function isStyleLayerVisibleAtZoom(styleLayer: BasemapStyleLayer, zoom: number): boolean {
  const {minzoom, maxzoom} = styleLayer;
  return (minzoom === undefined || zoom >= minzoom) && (maxzoom === undefined || zoom < maxzoom);
}

function getTileFeatures(data: unknown): any[] {
  if (Array.isArray(data)) {
    return data;
  }

  if (
    data &&
    typeof data === 'object' &&
    Array.isArray((data as {features?: unknown[]}).features)
  ) {
    return (data as {features: unknown[]}).features as any[];
  }

  return [];
}

function getSubLayerBaseProps(props: any) {
  const {
    pickable,
    visible,
    opacity,
    modelMatrix,
    coordinateSystem,
    coordinateOrigin,
    extensions,
    highlightedObjectIndex,
    highlightColor,
    parameters,
    wrapLongitude
  } = props;

  return {
    pickable,
    visible,
    opacity,
    modelMatrix,
    coordinateSystem,
    coordinateOrigin,
    extensions,
    highlightedObjectIndex,
    highlightColor,
    parameters,
    wrapLongitude
  };
}

function getGlobeFillColor(color: [number, number, number, number], mode: BasemapMode) {
  if (mode !== 'globe') {
    return color;
  }

  return [color[0], color[1], color[2], 255] as [number, number, number, number];
}

function getConfig(globe?: {config?: BasemapGlobeConfig}): BasemapLayerConfig {
  return {...DEFAULT_CONFIG, ...(globe?.config || {})};
}

function createBackgroundLayer({
  idPrefix,
  layer,
  zoom,
  mode
}: {
  idPrefix: string;
  layer: BasemapStyleLayer;
  zoom: number;
  mode: BasemapMode;
}) {
  const paint = getPaint(layer, zoom);

  return new SolidPolygonLayer({
    id: `${idPrefix}-${layer.id}`,
    data: BACKGROUND_DATA,
    getPolygon: d => d,
    stroked: false,
    filled: true,
    getFillColor: withOpacity(paint['background-color'], paint['background-opacity'] ?? 1),
    parameters: getBackgroundParameters(mode)
  });
}

function createRasterLayer({
  idPrefix,
  layer,
  source,
  mode
}: {
  idPrefix: string;
  layer: BasemapStyleLayer;
  source: BasemapSource;
  mode: BasemapMode;
}) {
  return new TileLayer({
    id: `${idPrefix}-${layer.id}`,
    data: source.tiles,
    minZoom: source.minzoom ?? 0,
    maxZoom: source.maxzoom ?? 22,
    tileSize: source.tileSize || 512,
    renderSubLayers: props => {
      const {west, south, east, north} = (props.tile?.bbox || {}) as {
        west: number;
        south: number;
        east: number;
        north: number;
      };

      return new BitmapLayer({
        ...props,
        _imageCoordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        data: null,
        image: props.data,
        bounds: [west, south, east, north],
        parameters: getTileParameters(mode)
      } as any);
    },
    onTileError: error => {
      logBasemapRuntimeError('Raster tile failed to load', error, {
        layerId: layer.id,
        sourceId: layer.source
      });
    },
    parameters: getTileParameters(mode)
  });
}

class StyledMVTLayer extends MVTLayer<any> {
  getTileData(loadProps: {index: {x: number; y: number; z: number}; signal?: AbortSignal}) {
    const data = this.props.data;
    const url = _getURLFromTemplate(data, loadProps as any);
    if (!url) {
      return Promise.reject(new Error('Invalid URL'));
    }

    const loadOptions = this.getLoadOptions();
    const coordinates = this.context.viewport.resolution ? 'wgs84' : 'local';

    return this.props.fetch(url, {
      propName: 'data',
      layer: this,
      signal: loadProps.signal,
      loadOptions: {
        ...loadOptions,
        mimeType: 'application/x-protobuf',
        mvt: {
          ...((loadOptions?.mvt as Record<string, unknown> | undefined) || {}),
          shape: 'geojson',
          coordinates,
          tileIndex: loadProps.index
        }
      }
    });
  }
}

StyledMVTLayer.layerName = 'StyledMVTLayer';
StyledMVTLayer.defaultProps = {
  ...MVTLayer.defaultProps,
  binary: false,
  loaders: [MVTWorkerLoader]
};

function createStyledVectorSubLayer({
  idPrefix,
  sourceId,
  styleLayer,
  features,
  props,
  zoom,
  config,
  mode,
  collisionPriorityRange,
  spriteAtlases,
  loadOptions
}: {
  idPrefix: string;
  sourceId: string;
  styleLayer: BasemapStyleLayer;
  features: any[];
  props: any;
  zoom: number;
  config: BasemapLayerConfig;
  mode: BasemapMode;
  collisionPriorityRange?: [number, number];
  spriteAtlases?: SpriteAtlas[] | null;
  loadOptions?: BasemapLoadOptions;
}) {
  if (features.length === 0) {
    return null;
  }

  if (styleLayer.type === 'symbol') {
    const paint = getPaint(styleLayer, zoom);
    return createSymbolSubLayer({
      props,
      styleLayer,
      features,
      config,
      mode,
      zoom,
      opacity: 1,
      paint,
      collisionPriorityRange,
      spriteAtlases,
      loadOptions
    });
  }

  return createGeometrySubLayer({props, styleLayer, features, mode, zoom});
}

function createVectorLayerGroup({
  idPrefix,
  sourceId,
  source,
  styleLayers,
  zoom,
  config,
  loadOptions,
  mode,
  labelPriorityRanges,
  styleDefinition,
  spriteAtlases
}: {
  idPrefix: string;
  sourceId: string;
  source: BasemapSource;
  styleLayers: BasemapStyleLayer[];
  zoom: number;
  config: BasemapLayerConfig;
  loadOptions?: BasemapLoadOptions;
  mode: BasemapMode;
  labelPriorityRanges?: Map<BasemapStyleLayer, [number, number]>;
  /** The resolved style, compared by identity to regenerate tiles when the style changes. */
  styleDefinition?: ResolvedBasemapStyle;
  /** Sprites for `icon-image`; tiles regenerate when they finish loading. */
  spriteAtlases?: SpriteAtlas[] | null;
}) {
  // The tile pyramid's range; style layers are gated by their own range in renderSubLayers.
  const minZoom = source.minzoom ?? 0;
  const maxZoom = source.maxzoom ?? 22;

  return new StyledMVTLayer({
    id: `${idPrefix}-${sourceId}`,
    data: source.tiles,
    binary: false,
    minZoom,
    maxZoom,
    tileSize: source.tileSize || 512,
    loadOptions: {
      ...(loadOptions || {}),
      mvt: {
        ...((loadOptions?.mvt as Record<string, unknown> | undefined) || {}),
        shape: 'geojson'
      }
    },
    onTileError: error => {
      logBasemapRuntimeError('Vector tile layer failed', error, {
        sourceId
      });
    },
    onTileLoad: tile => {
      const features = Array.isArray(tile.content) ? tile.content : [];
      if (features.length === 0) {
        logBasemapRuntimeEvent('Loaded empty vector tile', {
          sourceId,
          tileIndex: tile.index
        });
      }
    },
    parameters: getTileParameters(mode),
    // `renderSubLayers` reads `zoom` and the style: regenerate tile sublayers at each style zoom
    // step (evaluation and filters), at fractional layer limits (visibility), and when the style
    // changes. Two styles can share a source id and so this layer's id; deck.gl compares the
    // style by identity.
    updateTriggers: {
      renderSubLayers: [
        getStyleZoomKey(zoom, getStyleZoomLimits(styleLayers)),
        styleDefinition,
        spriteAtlases
      ]
    },
    renderSubLayers: props => {
      const features = getTileFeatures(props.data);
      const layers = styleLayers
        .map(styleLayer => {
          if (!isStyleLayerVisibleAtZoom(styleLayer, zoom)) {
            return null;
          }

          const filteredData = filterTileFeatures(features, styleLayer, zoom);

          if (features.length > 0 && filteredData.length === 0) {
            logBasemapRuntimeEvent('Vector tile rendered no matching features', {
              sourceId,
              layerId: styleLayer.id,
              sourceLayer: styleLayer['source-layer'],
              tileIndex: props.tile?.index
            });
          }

          return createStyledVectorSubLayer({
            idPrefix,
            sourceId,
            styleLayer,
            features: filteredData,
            props,
            zoom,
            config,
            mode,
            collisionPriorityRange: labelPriorityRanges?.get(styleLayer),
            spriteAtlases,
            loadOptions
          });
        })
        .filter(layer => Boolean(layer));

      return layers as any;
    }
  } as any);
}

function inferWaterColor(
  styleLayers: BasemapStyleLayer[],
  zoom: number
): [number, number, number, number] {
  const waterLayer = styleLayers.find(
    layer => layer.type === 'fill' && `${layer['source-layer'] || ''}`.includes('water')
  );

  if (!waterLayer) {
    return [20, 40, 68, 255];
  }

  const paint = getPaint(waterLayer, zoom);
  return withOpacity(paint['fill-color'], paint['fill-opacity'] ?? 1);
}

function getVectorSourceGroups(
  styleLayers: BasemapStyleLayer[],
  styleDefinition: ResolvedBasemapStyle
): VectorSourceGroup[] {
  const groups = new Map<string, VectorSourceGroup>();

  for (const layer of styleLayers) {
    const sourceId = layer.source;
    const source = sourceId ? styleDefinition.sources?.[sourceId] : null;
    if (sourceId && source?.tiles && source.type === 'vector') {
      appendVectorSourceGroup(groups, sourceId, source, layer);
    }
  }

  return [...groups.values()];
}

/** All style-layer `minzoom`/`maxzoom` limits in a style. */
export function getStyleDefinitionZoomLimits(
  styleDefinition: BasemapLayerGroup['styleDefinition']
): (number | undefined)[] {
  return getStyleZoomLimits(styleDefinition.layers || []);
}

export function getBasemapLayers({
  idPrefix = 'basemap',
  mode = 'map',
  globe,
  styleDefinition,
  zoom = 0,
  loadOptions,
  spriteAtlases
}: BasemapLayerGroup) {
  const config = getConfig(globe);
  const styleLayers = (styleDefinition.layers || []).filter(layer =>
    SUPPORTED_TYPES.has(layer.type)
  );
  const layers: any[] = [];
  logBasemapRuntimeEvent('Generating basemap layers', {
    mode,
    styleLayerCount: styleLayers.length,
    sourceCount: Object.keys(styleDefinition.sources || {}).length
  });

  layers.push(...getGlobePreLayers({idPrefix, mode, config, styleLayers}));

  if (config.basemap) {
    layers.push(...getBackgroundLayers({idPrefix, styleLayers, zoom, mode}));
    layers.push(
      ...getVectorLayers({
        idPrefix,
        styleLayers,
        styleDefinition,
        zoom,
        config,
        loadOptions,
        mode,
        spriteAtlases
      })
    );
    layers.push(...getRasterLayers({idPrefix, styleLayers, styleDefinition, zoom, mode}));
  }

  layers.push(...getGlobePostLayers({idPrefix, mode, config, styleLayers, zoom}));

  return layers.filter(layer => Boolean(layer));
}

export function getGlobeBaseLayers({
  globe,
  styleDefinition,
  idPrefix = 'globe-basemap',
  zoom = 0,
  loadOptions,
  spriteAtlases
}: Omit<BasemapLayerGroup, 'mode'>) {
  return getBasemapLayers({
    idPrefix,
    mode: 'globe',
    globe,
    styleDefinition,
    zoom,
    loadOptions,
    spriteAtlases
  });
}

export function getGlobeTopLayers({globe}: {globe: {config: BasemapGlobeConfig}}) {
  const {config} = globe;
  return config.atmosphere ? [getGlobeAtmosphereLayer()] : [];
}

function createSymbolSubLayer({
  props,
  styleLayer,
  features,
  config,
  mode,
  zoom,
  opacity,
  paint,
  collisionPriorityRange,
  spriteAtlases,
  loadOptions
}: {
  props: any;
  styleLayer: BasemapStyleLayer;
  features: any[];
  config: BasemapLayerConfig;
  mode: BasemapMode;
  zoom: number;
  opacity: number;
  paint: Record<string, any>;
  collisionPriorityRange?: [number, number];
  spriteAtlases?: SpriteAtlas[] | null;
  loadOptions?: BasemapLoadOptions;
}) {
  return new MVTLabelLayer({
    ...getSubLayerBaseProps(props),
    id: `${props.id}-${styleLayer.id}`,
    data: features,
    config,
    mode,
    styleLayer,
    collisionPriorityRange,
    spriteAtlases,
    // The sprite atlas images load through the same fetch as the style and its tiles.
    iconLoadOptions: loadOptions,
    zoom: getZoomBucket(zoom),
    // The style spec's default `text-color` is black.
    textColor: withOpacity(paint['text-color'] ?? DEFAULT_TEXT_COLOR, opacity),
    // The halo keeps its own alpha, scaled by the layer opacity like the text.
    labelBackground: paint['text-halo-color']
      ? withOpacity(paint['text-halo-color'], opacity)
      : null,
    billboard: true
  });
}

function createGeometrySubLayer({
  props,
  styleLayer,
  features,
  mode,
  zoom
}: {
  props: any;
  styleLayer: BasemapStyleLayer;
  features: any[];
  mode: BasemapMode;
  zoom: number;
}) {
  const isLine = styleLayer.type === 'line';
  const isFill = styleLayer.type === 'fill';
  const opacityProperty = isFill ? 'fill-opacity' : 'line-opacity';

  const fillColor = getStyleAccessor(
    styleLayer,
    ['fill-color', opacityProperty],
    zoom,
    ([color, opacity]) => getGlobeFillColor(withOpacity(color, opacity ?? 1), mode)
  );
  const lineColor = getStyleAccessor(
    styleLayer,
    ['line-color', 'fill-outline-color', opacityProperty],
    zoom,
    ([color, outlineColor, opacity]) =>
      withOpacity(color || outlineColor || [0, 0, 0, 0], opacity ?? 1)
  );
  const lineWidth = getStyleAccessor(styleLayer, ['line-width'], zoom, ([width]) =>
    Math.max(0, Number(width ?? 1))
  );

  return new GeoJsonLayer({
    ...getSubLayerBaseProps(props),
    id: `${props.id}-${styleLayer.id}`,
    data: features,
    stroked: isLine,
    filled: isFill,
    getFillColor: isFill ? (fillColor.value as any) : [0, 0, 0, 0],
    getLineColor: lineColor.value as any,
    getLineWidth: isLine ? (lineWidth.value as any) : 0,
    updateTriggers: {
      getFillColor: isFill ? fillColor.updateTrigger : undefined,
      getLineColor: lineColor.updateTrigger,
      getLineWidth: isLine ? lineWidth.updateTrigger : undefined
    },
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 0,
    lineCapRounded: isLine,
    lineJointRounded: isLine,
    getPointRadius: 0,
    pointRadiusMinPixels: 0,
    parameters: getTileParameters(mode)
  });
}

function getBackgroundLayers({
  idPrefix,
  styleLayers,
  zoom,
  mode
}: {
  idPrefix: string;
  styleLayers: BasemapStyleLayer[];
  zoom: number;
  mode: BasemapMode;
}) {
  return styleLayers
    .filter(layer => layer.type === 'background' && isStyleLayerVisibleAtZoom(layer, zoom))
    .map(layer => createBackgroundLayer({idPrefix, layer, zoom, mode}));
}

/** deck.gl's `CollisionFilterExtension` supports priorities from -1000 to 1000. */
const COLLISION_PRIORITY_RANGE: [number, number] = [-1000, 1000];

/**
 * Splits the collision priority range into one band per symbol layer, in style order. All labels
 * share one collision group, so a later style layer's band is above an earlier one's: MapLibre
 * places symbol layers from the top of the style down, and `symbol-sort-key` only orders labels
 * within a layer.
 */
function getLabelPriorityRanges(
  styleLayers: BasemapStyleLayer[]
): Map<BasemapStyleLayer, [number, number]> {
  const symbolLayers = styleLayers.filter(layer => layer.type === 'symbol');
  const [min, max] = COLLISION_PRIORITY_RANGE;
  const width = (max - min) / Math.max(symbolLayers.length, 1);
  return new Map(
    symbolLayers.map((layer, index) => [layer, [min + index * width, min + (index + 1) * width]])
  );
}

function getVectorLayers({
  idPrefix,
  styleLayers,
  styleDefinition,
  zoom,
  config,
  loadOptions,
  mode,
  spriteAtlases
}: {
  idPrefix: string;
  styleLayers: BasemapStyleLayer[];
  styleDefinition: ResolvedBasemapStyle;
  zoom: number;
  config: BasemapLayerConfig;
  loadOptions?: BasemapLoadOptions;
  mode: BasemapMode;
  spriteAtlases?: SpriteAtlas[] | null;
}) {
  const vectorLayers = styleLayers.filter(layer =>
    layer.type === 'symbol' ? config.labels : layer.type === 'fill' || layer.type === 'line'
  );

  // A group keeps all of its source's style layers, visible or not: its tile regeneration key
  // must change when any of them crosses its own limits, and `renderSubLayers` gates each layer
  // by zoom. Skip a source only when none of its layers are visible, and draw sources in the
  // order of their first visible layer, so a hidden layer does not move its source forward.
  const labelPriorityRanges = getLabelPriorityRanges(vectorLayers);
  const firstVisibleIndex = (group: VectorSourceGroup): number =>
    vectorLayers.findIndex(
      layer => layer.source === group.sourceId && isStyleLayerVisibleAtZoom(layer, zoom)
    );
  return getVectorSourceGroups(vectorLayers, styleDefinition)
    .filter(group => firstVisibleIndex(group) >= 0)
    .sort((a, b) => firstVisibleIndex(a) - firstVisibleIndex(b))
    .map(group =>
      createVectorLayerGroup({
        idPrefix,
        sourceId: group.sourceId,
        source: group.source,
        styleLayers: group.styleLayers,
        zoom,
        config,
        loadOptions,
        mode,
        labelPriorityRanges,
        styleDefinition,
        spriteAtlases
      })
    );
}

function getRasterLayers({
  idPrefix,
  styleLayers,
  styleDefinition,
  zoom,
  mode
}: {
  idPrefix: string;
  styleLayers: BasemapStyleLayer[];
  styleDefinition: ResolvedBasemapStyle;
  zoom: number;
  mode: BasemapMode;
}) {
  const rasterLayers = [];

  for (const layer of styleLayers) {
    if (layer.type === 'raster' && isStyleLayerVisibleAtZoom(layer, zoom)) {
      const source = styleDefinition.sources?.[layer.source];
      if (!source?.tiles) {
        logBasemapRuntimeEvent('Skipping style layer without resolved tiles', {
          layerId: layer.id,
          sourceId: layer.source
        });
      } else {
        rasterLayers.push(createRasterLayer({idPrefix, layer, source, mode}));
      }
    }
  }

  return rasterLayers;
}

function appendVectorSourceGroup(
  groups: Map<string, VectorSourceGroup>,
  sourceId: string,
  source: BasemapSource,
  layer: BasemapStyleLayer
) {
  const group = groups.get(sourceId);
  if (group) {
    group.styleLayers.push(layer);
    return;
  }

  groups.set(sourceId, {
    sourceId,
    source,
    styleLayers: [layer]
  });
}

function getGlobePreLayers({
  idPrefix,
  mode,
  config,
  styleLayers
}: {
  idPrefix: string;
  mode: BasemapMode;
  config: BasemapLayerConfig;
  styleLayers: BasemapStyleLayer[];
}) {
  const layers = [];

  if (mode === 'globe' && config.atmosphere) {
    layers.push(getGlobeAtmosphereSkyLayer());
  }

  const hasBackground = styleLayers.some(layer => layer.type === 'background');
  if (mode === 'globe' && !hasBackground) {
    layers.push(
      new SolidPolygonLayer({
        id: `${idPrefix}-background-fallback`,
        data: BACKGROUND_DATA,
        getPolygon: d => d,
        stroked: false,
        filled: true,
        getFillColor: [10, 24, 46, 255],
        parameters: getBackgroundParameters(mode)
      })
    );
  }

  return layers;
}

function getGlobePostLayers({
  idPrefix,
  mode,
  config,
  styleLayers,
  zoom
}: {
  idPrefix: string;
  mode: BasemapMode;
  config: BasemapLayerConfig;
  styleLayers: BasemapStyleLayer[];
  zoom: number;
}) {
  const layers = [];

  if (mode === 'globe' && config.basemap) {
    layers.push(
      new SolidPolygonLayer({
        id: `${idPrefix}-background-north-pole`,
        data: BACKGROUND_NORTH_POLE_DATA,
        getPolygon: d => d,
        stroked: false,
        filled: true,
        getFillColor: inferWaterColor(styleLayers, zoom),
        parameters: getBackgroundParameters(mode)
      })
    );
  }

  if (mode === 'globe' && config.atmosphere) {
    layers.push(getGlobeAtmosphereLayer());
  }

  return layers;
}
