import {COORDINATE_SYSTEM} from '@deck.gl/core';
import {MVTLayer, TileLayer, _getURLFromTemplate} from '@deck.gl/geo-layers';
import {BitmapLayer, GeoJsonLayer, SolidPolygonLayer} from '@deck.gl/layers';
import {MVTWorkerLoader} from '@loaders.gl/mvt';
import {getGlobeAtmosphereLayer, getGlobeAtmosphereSkyLayer} from './AtmosphereLayer';
import {MVTLabelLayer} from './MVTLabelLayer';
import {filterFeatures, parseProperties} from './style-spec';
import type {
  BasemapGlobeConfig,
  BasemapLayerProps
} from './basemap-layer';
import type {
  BasemapLoadOptions,
  BasemapSource,
  BasemapStyleLayer,
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
};

type VectorSourceGroup = {
  sourceId: string;
  source: BasemapSource;
  styleLayers: BasemapStyleLayer[];
};

function logBasemapRuntimeEvent(message: string, details?: unknown): void {
  if (details !== undefined) {
    console.info(`[BasemapLayer] ${message}`, details);
  } else {
    console.info(`[BasemapLayer] ${message}`);
  }
}

function logBasemapRuntimeError(message: string, error: unknown, details?: unknown): void {
  console.error(`[BasemapLayer] ${message}`, details || '', error);
}

function getBackgroundParameters(mode: BasemapMode) {
  return mode === 'globe'
    ? {depthTest: true, depthWriteEnabled: true, depthCompare: 'less-equal', cullMode: 'back'}
    : {depthTest: false, cullMode: 'none'};
}

function getTileParameters(mode: BasemapMode) {
  return mode === 'globe'
    ? {depthTest: true, depthWriteEnabled: true, depthCompare: 'less-equal', cullMode: 'back'}
    : {depthTest: false, cullMode: 'none'};
}

const BACKGROUND_DATA = [[[-180, 90], [0, 90], [180, 90], [180, -90], [0, -90], [-180, -90]]];

const BACKGROUND_NORTH_POLE_DATA = [
  [[-180, 90], [0, 90], [180, 90], [180, 85], [0, 85], [-180, 85]]
];

const SUPPORTED_TYPES = new Set(['background', 'fill', 'line', 'symbol', 'raster']);
const DEFAULT_CONFIG: BasemapLayerConfig = {atmosphere: false, basemap: true, labels: true};
function withOpacity(color: number[] | null | undefined, opacity = 1): [number, number, number, number] {
  if (!color) {
    return [0, 0, 0, 0];
  }

  const alpha = color.length > 3 ? (color[3] <= 1 ? color[3] * 255 : color[3]) : 255;
  return [color[0], color[1], color[2], Math.round(alpha * opacity)];
}

function getPaint(layer: BasemapStyleLayer, zoom: number): Record<string, any> {
  const properties = parseProperties(layer, {zoom});
  return Object.fromEntries(properties.map(entry => [Object.keys(entry)[0], Object.values(entry)[0]]));
}

function filterTileFeatures(features: any[], styleLayer: BasemapStyleLayer, zoom: number): any[] {
  const sourceLayer = styleLayer['source-layer'];
  const sourceFeatures = sourceLayer
    ? features.filter(feature => feature.properties?.layerName === sourceLayer)
    : features;

  if (!styleLayer.filter) {
    return sourceFeatures;
  }

  return filterFeatures({features: sourceFeatures, filter: styleLayer.filter, globalProperties: {zoom}});
}

function getTileFeatures(data: unknown): any[] {
  if (Array.isArray(data)) {
    return data;
  }

  if (data && typeof data === 'object' && Array.isArray((data as {features?: unknown[]}).features)) {
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

function getLineWidthScale(styleLayer: BasemapStyleLayer): number {
  const sourceLayer = styleLayer['source-layer'] || '';
  const id = styleLayer.id || '';

  if (sourceLayer === 'transportation' || sourceLayer === 'boundary' || id.includes('road-')) {
    return 0.55;
  }

  if (sourceLayer === 'waterway' || sourceLayer === 'aeroway') {
    return 0.75;
  }

  return 1;
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
    minZoom: layer.minzoom ?? source.minzoom ?? 0,
    maxZoom: layer.maxzoom ?? source.maxzoom ?? 22,
    tileSize: source.tileSize || 512,
    renderSubLayers: props => {
      const {
        bbox: {west, south, east, north}
      } = props.tile;

      return new BitmapLayer(props, {
        _imageCoordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        data: null,
        image: props.data,
        bounds: [west, south, east, north],
        parameters: getTileParameters(mode)
      });
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
          ...loadOptions?.mvt,
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
  mode
}: {
  idPrefix: string;
  sourceId: string;
  styleLayer: BasemapStyleLayer;
  features: any[];
  props: any;
  zoom: number;
  config: BasemapLayerConfig;
  mode: BasemapMode;
}) {
  if (features.length === 0) {
    return null;
  }

  const paint = getPaint(styleLayer, zoom);
  const opacity =
    paint[`${styleLayer.type}-opacity`] ??
    (styleLayer.type === 'fill' ? paint['fill-opacity'] : paint['line-opacity']) ??
    1;
  const fillColor = withOpacity(paint['fill-color'], opacity);
  const lineColor = withOpacity(paint['line-color'] || paint['fill-outline-color'] || [0, 0, 0, 0], opacity);

  if (styleLayer.type === 'symbol') {
    return new MVTLabelLayer({
      ...getSubLayerBaseProps(props),
      id: `${props.id}-${styleLayer.id}`,
      data: features,
      config,
      mode,
      styleLayer,
      zoom,
      textColor: withOpacity(paint['text-color'], opacity),
      labelBackground: paint['text-halo-color']
        ? withOpacity(paint['text-halo-color'], paint['text-halo-width'] ? 255 : opacity)
        : null,
      billboard: true
    });
  }

  return new GeoJsonLayer({
    ...getSubLayerBaseProps(props),
    id: `${props.id}-${styleLayer.id}`,
    data: features,
    stroked: styleLayer.type === 'line',
    filled: styleLayer.type === 'fill',
    getFillColor: styleLayer.type === 'fill' ? getGlobeFillColor(fillColor, mode) : [0, 0, 0, 0],
    getLineColor: lineColor,
    getLineWidth:
      styleLayer.type === 'line'
        ? Math.max(0.25, Number(paint['line-width'] ?? 1) * getLineWidthScale(styleLayer))
        : 0,
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 0,
    lineWidthMaxPixels: 20,
    lineCapRounded: styleLayer.type === 'line',
    lineJointRounded: styleLayer.type === 'line',
    getPointRadius: 0,
    pointRadiusMinPixels: 0,
    parameters: getTileParameters(mode)
  });
}

function createVectorLayerGroup({
  idPrefix,
  sourceId,
  source,
  styleLayers,
  zoom,
  config,
  loadOptions,
  mode
}: {
  idPrefix: string;
  sourceId: string;
  source: BasemapSource;
  styleLayers: BasemapStyleLayer[];
  zoom: number;
  config: BasemapLayerConfig;
  loadOptions?: BasemapLoadOptions;
  mode: BasemapMode;
}) {
  const minZoom = Math.min(...styleLayers.map(layer => layer.minzoom ?? source.minzoom ?? 0));
  const maxZoom = Math.max(...styleLayers.map(layer => layer.maxzoom ?? source.maxzoom ?? 22));

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
        ...loadOptions?.mvt,
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
    renderSubLayers: props => {
      const features = getTileFeatures(props.data);
      const layers = styleLayers
        .map(styleLayer => {
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
            mode
          });
        })
        .filter(Boolean);

      return layers;
    }
  });
}

function inferWaterColor(styleLayers: BasemapStyleLayer[], zoom: number): [number, number, number, number] {
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
    if (!layer.source) {
      continue;
    }

    const source = styleDefinition.sources?.[layer.source];
    if (!source?.tiles || source.type !== 'vector') {
      continue;
    }

    const group = groups.get(layer.source);
    if (group) {
      group.styleLayers.push(layer);
    } else {
      groups.set(layer.source, {
        sourceId: layer.source,
        source,
        styleLayers: [layer]
      });
    }
  }

  return [...groups.values()];
}

export function getBasemapLayers({
  idPrefix = 'basemap',
  mode = 'map',
  globe,
  styleDefinition,
  zoom = 0,
  loadOptions
}: BasemapLayerGroup) {
  const config = getConfig(globe);
  const styleLayers = (styleDefinition.layers || []).filter(layer => SUPPORTED_TYPES.has(layer.type));
  const layers = [];
  logBasemapRuntimeEvent('Generating basemap layers', {
    mode,
    styleLayerCount: styleLayers.length,
    sourceCount: Object.keys(styleDefinition.sources || {}).length
  });

  if (mode === 'globe' && config.atmosphere) {
    layers.push(getGlobeAtmosphereSkyLayer({config}));
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

  if (config.basemap) {
    for (const layer of styleLayers) {
      if (layer.type === 'background') {
        layers.push(createBackgroundLayer({idPrefix, layer, zoom, mode}));
      }
    }

    for (const group of getVectorSourceGroups(
      styleLayers.filter(layer => {
        if (layer.type === 'symbol') {
          return config.labels;
        }
        return layer.type === 'fill' || layer.type === 'line';
      }),
      styleDefinition
    )) {
      layers.push(
        createVectorLayerGroup({
          idPrefix,
          sourceId: group.sourceId,
          source: group.source,
          styleLayers: group.styleLayers,
          zoom,
          config,
          loadOptions,
          mode
        })
      );
    }

    for (const layer of styleLayers) {
      if (layer.type !== 'raster') {
        continue;
      }

      const source = styleDefinition.sources?.[layer.source];
      if (!source?.tiles) {
        logBasemapRuntimeEvent('Skipping style layer without resolved tiles', {
          layerId: layer.id,
          sourceId: layer.source
        });
        continue;
      }

      layers.push(createRasterLayer({idPrefix, layer, source, mode}));
    }
  }

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
    layers.push(getGlobeAtmosphereLayer({config}));
  }

  return layers.filter(Boolean);
}

export function getGlobeBaseLayers({
  globe,
  styleDefinition,
  idPrefix = 'globe-basemap',
  zoom = 0,
  loadOptions
}: Omit<BasemapLayerGroup, 'mode'>) {
  return getBasemapLayers({idPrefix, mode: 'globe', globe, styleDefinition, zoom, loadOptions});
}

export function getGlobeTopLayers({globe}: {globe: {config: BasemapGlobeConfig}}) {
  const {config} = globe;
  return [config.atmosphere && getGlobeAtmosphereLayer({config})].filter(Boolean);
}
