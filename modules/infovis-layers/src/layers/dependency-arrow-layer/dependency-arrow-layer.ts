import {CompositeLayer} from '@deck.gl/core';
import {ArcLayer, LineLayer, PathLayer} from '@deck.gl/layers';
import {Vector3} from '@math.gl/core';

import {createPathMarkers, PathDirection, PathGeometry} from './create-path-markers';
import {GeometryLayer} from './geometry-layer';

import type {
  MarkerPlacementsAccessor,
  PathDirectionAccessor,
  PathMarker
} from './create-path-markers';
import type {
  Accessor,
  Color,
  DefaultProps,
  GetPickingInfoParams,
  Layer,
  LayerDataSource,
  LayerProps,
  Position,
  UpdateParameters
} from '@deck.gl/core';
import type {ArcLayerProps, LineLayerProps, PathLayerProps} from '@deck.gl/layers';

export {PathDirection};

export type DependencyArrowLayerProps<DataT = unknown> = LayerProps &
  _DependencyArrowLayerProps<DataT>;

type _DependencyArrowLayerProps<DataT = unknown> = {
  data: LayerDataSource<DataT>;
  mode?: 'path' | 'line' | 'arc';

  getPath?: PathLayerProps<DataT>['getPath'];
  getColor?: LineLayerProps<DataT>['getColor'];
  getWidth?: LineLayerProps<DataT>['getWidth'];
  widthUnits?: LineLayerProps<DataT>['widthUnits'];
  widthScale?: LineLayerProps<DataT>['widthScale'];
  widthMinPixels?: LineLayerProps<DataT>['widthMinPixels'];
  widthMaxPixels?: LineLayerProps<DataT>['widthMaxPixels'];

  arcNumSegments?: ArcLayerProps<DataT>['numSegments'];
  getArcHeight?: ArcLayerProps<DataT>['getHeight'];
  getArcTilt?: ArcLayerProps<DataT>['getTilt'];

  /** Path direction */
  getDirection?: PathDirectionAccessor<DataT>;
  /** Marker color, falls back to path color (getColor) if not specified */
  getMarkerColor?: Accessor<DataT, Color>;
  /** Returns a list of positions to place the marker at. Each position is a ratio on the path, 0 is the start, 1 is the end */
  getMarkerPlacements?: MarkerPlacementsAccessor<DataT>;
  /** Marker size in [widthPixels, heightPixels] */
  getMarkerSize?: Accessor<DataT, [number, number]>;
  highlightPoint?: Position | Vector3 | null;
  highlightIndex?: number;
  /** Marker size multiplier */
  markerSizeScale?: number;
};

const defaultProps: DefaultProps<_DependencyArrowLayerProps> = {
  getPath: PathLayer.defaultProps.getPath,
  getColor: LineLayer.defaultProps.getColor,
  getWidth: LineLayer.defaultProps.getWidth,
  widthUnits: LineLayer.defaultProps.widthUnits,
  widthScale: LineLayer.defaultProps.widthScale,
  widthMinPixels: LineLayer.defaultProps.widthMinPixels,
  widthMaxPixels: LineLayer.defaultProps.widthMaxPixels,
  arcNumSegments: ArcLayer.defaultProps.numSegments,
  getArcHeight: ArcLayer.defaultProps.getHeight,
  getArcTilt: ArcLayer.defaultProps.getTilt,

  mode: 'path',

  markerSizeScale: 10,

  highlightIndex: -1,
  highlightPoint: null,

  getMarkerColor: {type: 'accessor', value: undefined},
  getDirection: {type: 'accessor', value: PathDirection.FORWARD},
  getMarkerSize: {type: 'accessor', value: [1, 1]},
  getMarkerPlacements: {type: 'accessor', value: [0.5]}
};

export class DependencyArrowLayer<
  DataT = any,
  ExtraPropsT = Record<string, unknown>
> extends CompositeLayer<ExtraPropsT & Required<_DependencyArrowLayerProps<DataT>>> {
  static override layerName = 'DependencyArrowLayer';
  static override defaultProps = defaultProps;

  override state: {
    markers: PathMarker<DataT>[];
  } = {
    markers: []
  };

  override updateState({props, oldProps, changeFlags}: UpdateParameters<this>) {
    const shouldRebuildMarkers =
      changeFlags.dataChanged ||
      props.positionFormat !== oldProps.positionFormat ||
      (changeFlags.updateTriggersChanged &&
        (changeFlags.updateTriggersChanged['getPath'] ||
          changeFlags.updateTriggersChanged['getDirection'] ||
          changeFlags.updateTriggersChanged['getMarkerPlacement']));

    if (shouldRebuildMarkers) {
      const {data, mode, getPath, getDirection, getMarkerPlacements} = this.props;

      this.state.markers = createPathMarkers<DataT>({
        data: data as Iterable<DataT>,
        positionSize: props.positionFormat.length,
        getPath,
        getDirection,
        getMarkerPlacements,
        mode
      });
    }
  }

  override getPickingInfo({info}: GetPickingInfoParams) {
    const pickedObject = info.object;
    if (pickedObject && pickedObject.__source) {
      info.object = (pickedObject as PathMarker<DataT>).__source.object;
    }
    return info;
  }

  renderLayers() {
    const {
      mode,
      getPath,
      getColor,
      getMarkerColor,
      getMarkerSize,
      markerSizeScale,
      updateTriggers = {}
    } = this.props;

    let pathLayer: Layer | null = null;
    if (mode === 'path') {
      pathLayer = new PathLayer(
        this.props,
        this.getSubLayerProps({
          id: 'links-path',
          updateTriggers: {
            getPath: updateTriggers['getPath'],
            getColor: updateTriggers['getColor'],
            getWidth: updateTriggers['getWidth']
          }
        })
      );
    } else {
      const positionSize = this.props.positionFormat.length;
      const sharedProps = {
        ...this.props,
        data: this.props.data,
        getSourcePosition: (datum, info) => {
          const path = getPath(datum, info);
          return getFirstPoint(path, positionSize) ?? [NaN, NaN];
        },
        getTargetPosition: (datum, info) => {
          const path = getPath(datum, info);
          return getLastPoint(path, positionSize) ?? [NaN, NaN];
        }
      } satisfies LineLayerProps<DataT>;
      if (mode === 'arc') {
        pathLayer = new ArcLayer<DataT>(
          sharedProps,
          {
            getSourceColor: this.props.getColor,
            getTargetColor: this.props.getColor,
            numSegments: this.props.arcNumSegments,
            getHeight: this.props.getArcHeight,
            getTilt: this.props.getArcTilt
          },
          this.getSubLayerProps({
            id: 'links-arc',
            updateTriggers: {
              getSourcePosition: updateTriggers['getPath'],
              getTargetPosition: updateTriggers['getPath'],
              getSourceColor: updateTriggers['getColor'],
              getTargetColor: updateTriggers['getColor'],
              getWidth: updateTriggers['getWidth'],
              getHeight: updateTriggers['getArcHeight'],
              getTilt: updateTriggers['getArcTilt']
            }
          })
        );
      } else {
        pathLayer = new LineLayer<DataT>(
          sharedProps,
          this.getSubLayerProps({
            id: 'links-line',
            updateTriggers: {
              getSourcePosition: updateTriggers['getPath'],
              getTargetPosition: updateTriggers['getPath'],
              getColor: updateTriggers['getColor'],
              getWidth: updateTriggers['getWidth']
            }
          })
        );
      }
    }

    return [
      pathLayer,
      new GeometryLayer<PathMarker<DataT>>(
        this.getSubLayerProps({
          id: 'arrows',
          updateTriggers: {
            getSize: updateTriggers['getMarkerSize'],
            getColor: getMarkerColor
              ? updateTriggers['getMarkerColor']
              : updateTriggers['getColor'],
            getArcHeight: updateTriggers['getArcHeight'],
            getArcTilt: updateTriggers['getArcTilt']
          }
        }),
        {
          data: this.state.markers,
          sizeUnits: 'pixels',
          sizeScale: markerSizeScale,
          interpolationMode: mode === 'arc' ? 'arc' : 'line',
          getSourcePosition: d => d.source,
          getTargetPosition: d => d.target,
          getPositionRatio: d => d.percentage,
          getSize: this.getSubLayerAccessor(getMarkerSize) as Accessor<
            PathMarker<DataT>,
            [number, number]
          >,
          getColor: this.getSubLayerAccessor(getMarkerColor ?? getColor) as Accessor<
            PathMarker<DataT>,
            Color
          >,
          getArcHeight: this.getSubLayerAccessor(this.props.getArcHeight) as Accessor<
            PathMarker<DataT>,
            number
          >,
          getArcTilt: this.getSubLayerAccessor(this.props.getArcTilt) as Accessor<
            PathMarker<DataT>,
            number
          >,
          getPickingColor: d => this.encodePickingColor(d.__source.index)
        }
      )
    ];
  }
}

function getFirstPoint(path: PathGeometry, size: number): Position | null {
  if (!path || path.length === 0) return null;
  if (Array.isArray(path[0])) {
    return (path as Position[])[0]!;
  }
  return path.slice(0, size) as Position;
}

function getLastPoint(path: PathGeometry, size: number): Position | null {
  if (!path || path.length === 0) return null;
  if (Array.isArray(path[0])) {
    return (path as Position[])[path.length - 1]!;
  }
  const len = Math.floor(path.length / size) * size;
  return path.slice(len - size, len) as Position;
}
