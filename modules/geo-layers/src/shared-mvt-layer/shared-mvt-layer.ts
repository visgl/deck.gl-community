// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  COORDINATE_SYSTEM,
  type GetPickingInfoParams,
  type UpdateParameters,
  type Layer,
  type PickingInfo
} from '@deck.gl/core';
import {GeoJsonLayer, type GeoJsonLayerProps} from '@deck.gl/layers';
import {ClipExtension} from '@deck.gl/extensions';
import {Matrix4} from '@math.gl/core';
import {worldToLngLat} from '@math.gl/web-mercator';
import {load} from '@loaders.gl/core';
import {MVTWorkerLoader} from '@loaders.gl/mvt';
import {SharedTile2DLayer, type SharedTile2DLayerProps} from '../shared-tile-2d-layer/index';
import type {SharedTile2DHeader, TileLoadProps} from '../tileset/index';
import {getURLFromTemplate} from '../shared-tile-2d-layer/url-template';
import {isGlobeViewport} from '../utils/is-globe-viewport';

/** GeoJSON features decoded in normalized tile-local coordinates. */
export type SharedMVTData = Array<any>;
/** MVT rendering props; external tilesets must contain tile-local GeoJSON. */
export type SharedMVTLayerProps = SharedTile2DLayerProps<SharedMVTData> &
  Omit<GeoJsonLayerProps, 'data'> & {
    uniqueIdProperty?: string;
    highlightedFeatureId?: string | number | null;
  };

const WORLD_SIZE = 512;
const CLIP_BOUNDS = [0, 0, 1, 1] as const;
/** deck.gl's `PROJECTION_MODE.WEB_MERCATOR`, which `@deck.gl/core` does not export. */
const PROJECTION_MODE_WEB_MERCATOR = 1;

/**
 * The factor that turns meters in `z` into meters at the tile's latitude, on a map.
 *
 * In `CARTESIAN` coordinates, deck.gl scales `z` by the meters-to-common-units factor at its
 * geospatial origin. Below zoom 12 (`PROJECTION_MODE.WEB_MERCATOR`) that origin is (0, 0), so
 * heights come out as at the equator: `cos(latitude)` times too short. From zoom 12 the origin is
 * the viewport center, which already matches MapLibre and `LNGLAT` geometry.
 */
function getMVTHeightScale(
  index: {y: number; z: number},
  projectionMode: number | undefined
): number {
  if (projectionMode !== PROJECTION_MODE_WEB_MERCATOR) {
    return 1;
  }
  const [, latitude] = worldToLngLat([0, WORLD_SIZE * (1 - (index.y + 0.5) / 2 ** index.z)]);
  return 1 / Math.cos((latitude * Math.PI) / 180);
}

const geographicTiles = new WeakMap<SharedMVTData, Map<string, SharedMVTData>>();

/** Converts local tile geometry without mutating shared decoded content. */
export function getMVTDataInWGS84(
  data: SharedMVTData,
  index: {x: number; y: number; z: number}
): SharedMVTData {
  const key = `${index.x}/${index.y}/${index.z}`;
  let cache = geographicTiles.get(data);
  if (!cache) {
    cache = new Map();
    geographicTiles.set(data, cache);
  }
  let converted = cache.get(key);
  if (!converted) {
    const scale = 2 ** index.z;
    const convertCoordinates = (coordinates: any): any => {
      if (typeof coordinates[0] === 'number') {
        const [x, y, ...rest] = coordinates;
        return [
          ...worldToLngLat([
            (WORLD_SIZE * (index.x + x)) / scale,
            WORLD_SIZE * (1 - (index.y + y) / scale)
          ]),
          ...rest
        ];
      }
      return coordinates.map(convertCoordinates);
    };
    const convertGeometry = (geometry: any): any =>
      geometry &&
      (geometry.type === 'GeometryCollection'
        ? {...geometry, geometries: geometry.geometries.map(convertGeometry)}
        : {...geometry, coordinates: convertCoordinates(geometry.coordinates)});
    converted = data.map(feature => ({...feature, geometry: convertGeometry(feature.geometry)}));
    cache.set(key, converted);
  }
  return converted;
}

/** MVT adapter with view-independent decoded data and shared cache ownership. */
export class SharedMVTLayer extends SharedTile2DLayer<
  SharedMVTData,
  Omit<SharedMVTLayerProps, keyof SharedTile2DLayerProps>
> {
  declare state: SharedTile2DLayer<SharedMVTData>['state'] & {
    geographic?: boolean;
    projectionMode?: number;
    hoveredFeatureId?: string | number | null;
    hoveredFeatureLayerName?: string | null;
    highlightColor?: number[];
  };

  static layerName = 'SharedMVTLayer';
  static defaultProps: typeof SharedTile2DLayer.defaultProps = {
    ...GeoJsonLayer.defaultProps,
    ...SharedTile2DLayer.defaultProps,
    loaders: [MVTWorkerLoader],
    // External cache owners can load tiles before any consumer is initialized.
    fetch: (url, {layer, loadOptions, signal}) =>
      load(url, layer.props.loaders, {
        ...loadOptions,
        core: {...loadOptions?.core, fetch: {...loadOptions?.core?.fetch, signal}}
      }),
    uniqueIdProperty: '',
    highlightedFeatureId: null
  };

  /** Always decode locally so the same cache can serve map and globe consumers. */
  getTileData(tile: TileLoadProps): Promise<SharedMVTData> {
    const {data, fetch, getTileData} = this.props;
    if (getTileData) {
      return Promise.resolve(getTileData(tile) as SharedMVTData);
    }
    const url = getURLFromTemplate(data as string | string[] | null, tile);
    if (!url) {
      return Promise.reject(new Error('Invalid MVT URL template'));
    }
    const loadOptions = this.getLoadOptions();
    // loaders.gl 5 has no `geojson` shape. `geojson-table`, which loaders.gl 4 also has, wraps
    // the features in a table; unwrap it so tile content stays the feature array.
    return Promise.resolve(
      fetch(url, {
        propName: 'data',
        layer: this,
        signal: tile.signal,
        loadOptions: {
          ...loadOptions,
          mimeType: 'application/x-protobuf',
          mvt: {
            ...loadOptions?.mvt,
            shape: 'geojson-table',
            coordinates: 'local',
            tileIndex: tile.index
          }
        }
      })
    ).then(data => (data?.shape === 'geojson-table' ? data.features : data));
  }

  /** View changes invalidate render geometry, never the shared decoded cache. */
  updateState(params: UpdateParameters<this>): void {
    const geographic = isGlobeViewport(this.context.viewport);
    const {projectionMode} = this.context.viewport;
    if (this.state.geographic !== geographic || this.state.projectionMode !== projectionMode) {
      this.state.tileLayers.clear();
      this.state.geographic = geographic;
      this.state.projectionMode = projectionMode;
    }
    super.updateState(params);
  }

  /** Supplies local transforms/clipping on maps and geographic geometry on globes. */
  renderSubLayers(props: Parameters<SharedTile2DLayer<SharedMVTData>['renderSubLayers']>[0]) {
    if (!props.data) return null;
    const {x, y, z} = props.tile.index;
    const scale = WORLD_SIZE / 2 ** z;
    const geographic = isGlobeViewport(this.context.viewport);
    return super.renderSubLayers({
      ...props,
      autoHighlight: false,
      data: geographic ? getMVTDataInWGS84(props.data, props.tile.index) : props.data,
      modelMatrix: geographic
        ? new Matrix4()
        : new Matrix4().scale([
            scale,
            -scale,
            getMVTHeightScale(props.tile.index, this.context.viewport.projectionMode)
          ]),
      coordinateOrigin: geographic ? [0, 0, 0] : [scale * x, WORLD_SIZE - scale * y, 0],
      coordinateSystem: geographic ? COORDINATE_SYSTEM.LNGLAT : COORDINATE_SYSTEM.CARTESIAN,
      extensions: geographic ? props.extensions : [...(props.extensions || []), new ClipExtension()]
    });
  }

  /** Highlight matching feature IDs across every tile of this consumer. */
  getSubLayerPropsByTile(
    tile: SharedTile2DHeader<SharedMVTData>,
    layer?: Layer
  ): Record<string, any> {
    const {uniqueIdProperty, highlightedFeatureId} = this.props;
    const state = this.state;
    const explicit = highlightedFeatureId !== null && highlightedFeatureId !== undefined;
    const featureId = explicit ? highlightedFeatureId : state.hoveredFeatureId;
    const data = Array.isArray(layer?.props.data) ? layer.props.data : tile.content || [];
    const highlightedObjectIndex =
      featureId === null || featureId === undefined
        ? -1
        : data.findIndex(
            feature =>
              (uniqueIdProperty ? feature.properties?.[uniqueIdProperty] : feature.id) ===
                featureId &&
              (explicit || feature.properties?.layerName === state.hoveredFeatureLayerName)
          );
    return {
      clipBounds: CLIP_BOUNDS,
      highlightedObjectIndex,
      highlightColor: state.highlightColor || this.props.highlightColor
    };
  }

  /** Keep per-consumer highlight state rather than changing shared tile content. */
  protected _updateAutoHighlight(info: PickingInfo): void {
    const feature = info.object;
    const {uniqueIdProperty} = this.props;
    const highlightColor =
      typeof this.props.highlightColor === 'function'
        ? this.props.highlightColor(info)
        : this.props.highlightColor;
    this.setState({
      hoveredFeatureId: feature
        ? uniqueIdProperty
          ? feature.properties?.[uniqueIdProperty]
          : feature.id
        : null,
      hoveredFeatureLayerName: feature?.properties?.layerName,
      highlightColor
    });
  }

  /**
   * Return geographic picked geometry without changing the cached local feature. The picked
   * sublayer, not the current viewport, tells whether the feature is still tile-local: for a few
   * frames after a view switch, the sublayers built for the previous view are still drawn.
   */
  getPickingInfo(params: GetPickingInfoParams) {
    const info = super.getPickingInfo(params);
    const coordinateSystem = (params.sourceLayer?.props as any)?.coordinateSystem;
    if (info.object && coordinateSystem === COORDINATE_SYSTEM.CARTESIAN) {
      info.object = getMVTDataInWGS84([info.object], info.sourceTile.index)[0];
    }
    return info;
  }
}
