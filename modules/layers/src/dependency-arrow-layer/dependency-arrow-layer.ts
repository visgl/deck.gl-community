// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';
import {ArcLayer, LineLayer, PathLayer} from '@deck.gl/layers';
import {Vector3} from '@math.gl/core';

import {createPathMarkers, PathDirection} from './create-path-markers';
import {GeometryLayer} from './geometry-layer';

import type {
  MarkerPlacementsAccessor,
  PathDirectionAccessor,
  PathGeometry,
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

const DEFAULT_OUTLINE_COLOR: Color = [255, 255, 255, 220];

export {PathDirection};
export type {
  MarkerPlacementsAccessor,
  MarkerPlacementsAccessorContext,
  PathDirectionAccessor,
  PathGeometry,
  PathMarker
} from './create-path-markers';

/** Properties supported by {@link DependencyArrowLayer}. */
export type DependencyArrowLayerProps<DataT = unknown> = LayerProps &
  _DependencyArrowLayerProps<DataT>;

type _DependencyArrowLayerProps<DataT = unknown> = {
  /** Dependency data rendered by the layer. */
  data: LayerDataSource<DataT>;
  /** Dependency routing mode. @defaultValue 'path' */
  mode?: 'path' | 'line' | 'arc';

  /** Accessor returning nested or flat dependency path coordinates. */
  getPath?: PathLayerProps<DataT>['getPath'];
  /** Accessor returning dependency line color. */
  getColor?: LineLayerProps<DataT>['getColor'];
  /** Accessor returning dependency outline color. */
  getOutlineColor?: Accessor<DataT, Color>;
  /** Accessor returning dependency line width. */
  getWidth?: LineLayerProps<DataT>['getWidth'];
  /** Units used by dependency line width. */
  widthUnits?: LineLayerProps<DataT>['widthUnits'];
  /** Scale applied to dependency line width. */
  widthScale?: LineLayerProps<DataT>['widthScale'];
  /** Minimum rendered dependency line width in pixels. */
  widthMinPixels?: LineLayerProps<DataT>['widthMinPixels'];
  /** Maximum rendered dependency line width in pixels. */
  widthMaxPixels?: LineLayerProps<DataT>['widthMaxPixels'];
  /** Multiplier applied to the optional dependency outline pass. @defaultValue 1 */
  outlineWidthScale?: number;

  /** Arc segment count used when `mode` is `'arc'`. */
  arcNumSegments?: ArcLayerProps<DataT>['numSegments'];
  /** Accessor returning arc height when `mode` is `'arc'`. */
  getArcHeight?: ArcLayerProps<DataT>['getHeight'];
  /** Accessor returning arc tilt when `mode` is `'arc'`. */
  getArcTilt?: ArcLayerProps<DataT>['getTilt'];

  /** Accessor returning marker direction flags. @defaultValue PathDirection.FORWARD */
  getDirection?: PathDirectionAccessor<DataT>;
  /** Marker color accessor; falls back to `getColor` when omitted. */
  getMarkerColor?: Accessor<DataT, Color>;
  /** Accessor returning marker ratios along the path, from 0 at start to 1 at end. */
  getMarkerPlacements?: MarkerPlacementsAccessor<DataT>;
  /** Marker size accessor in marker-local `[width, height]` units. */
  getMarkerSize?: Accessor<DataT, [number, number]>;
  /** Optional point used by callers to identify a highlighted dependency location. */
  highlightPoint?: Position | Vector3 | null;
  /** Optional source datum index used with `highlightPoint`. */
  highlightIndex?: number;
  /** Marker size multiplier. @defaultValue 10 */
  markerSizeScale?: number;
};

const defaultProps: DefaultProps<_DependencyArrowLayerProps> = {
  getPath: PathLayer.defaultProps.getPath,
  getColor: LineLayer.defaultProps.getColor,
  getOutlineColor: {type: 'accessor', value: DEFAULT_OUTLINE_COLOR},
  getWidth: LineLayer.defaultProps.getWidth,
  widthUnits: LineLayer.defaultProps.widthUnits,
  widthScale: LineLayer.defaultProps.widthScale,
  widthMinPixels: LineLayer.defaultProps.widthMinPixels,
  widthMaxPixels: LineLayer.defaultProps.widthMaxPixels,
  outlineWidthScale: {type: 'number', min: 1, value: 1},
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

/** Renders paths, lines, or arcs with directional dependency markers. */
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
      props.mode !== oldProps.mode ||
      props.positionFormat !== oldProps.positionFormat ||
      props.getPath !== oldProps.getPath ||
      props.getDirection !== oldProps.getDirection ||
      props.getMarkerPlacements !== oldProps.getMarkerPlacements ||
      (changeFlags.updateTriggersChanged &&
        (changeFlags.updateTriggersChanged['getPath'] ||
          changeFlags.updateTriggersChanged['getDirection'] ||
          changeFlags.updateTriggersChanged['getMarkerPlacements']));

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
      getOutlineColor,
      getMarkerColor,
      getMarkerSize,
      markerSizeScale,
      outlineWidthScale,
      widthScale,
      updateTriggers = {}
    } = this.props;

    const layers: Layer[] = [];
    const shouldRenderOutline = outlineWidthScale > 1;
    const outlineScale = (widthScale ?? 1) * outlineWidthScale;
    if (mode === 'path') {
      if (shouldRenderOutline) {
        layers.push(
          new PathLayer(
            this.props,
            this.getSubLayerProps({
              id: 'links-path-outline',
              getColor: getOutlineColor,
              widthScale: outlineScale,
              updateTriggers: {
                getPath: updateTriggers['getPath'],
                getColor: updateTriggers['getOutlineColor'],
                getWidth: updateTriggers['getWidth']
              }
            })
          )
        );
      }
      layers.push(
        new PathLayer(
          this.props,
          this.getSubLayerProps({
            id: 'links-path',
            updateTriggers: {
              getPath: updateTriggers['getPath'],
              getColor: updateTriggers['getColor'],
              getWidth: updateTriggers['getWidth']
            }
          })
        )
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
        if (shouldRenderOutline) {
          layers.push(
            new ArcLayer<DataT>(
              sharedProps,
              {
                getSourceColor: getOutlineColor,
                getTargetColor: getOutlineColor,
                numSegments: this.props.arcNumSegments,
                getHeight: this.props.getArcHeight,
                getTilt: this.props.getArcTilt,
                widthScale: outlineScale
              },
              this.getSubLayerProps({
                id: 'links-arc-outline',
                updateTriggers: {
                  getSourcePosition: updateTriggers['getPath'],
                  getTargetPosition: updateTriggers['getPath'],
                  getSourceColor: updateTriggers['getOutlineColor'],
                  getTargetColor: updateTriggers['getOutlineColor'],
                  getWidth: updateTriggers['getWidth'],
                  getHeight: updateTriggers['getArcHeight'],
                  getTilt: updateTriggers['getArcTilt']
                }
              })
            )
          );
        }
        layers.push(
          new ArcLayer<DataT>(
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
          )
        );
      } else {
        if (shouldRenderOutline) {
          layers.push(
            new LineLayer<DataT>(
              sharedProps,
              this.getSubLayerProps({
                id: 'links-line-outline',
                getColor: getOutlineColor,
                widthScale: outlineScale,
                updateTriggers: {
                  getSourcePosition: updateTriggers['getPath'],
                  getTargetPosition: updateTriggers['getPath'],
                  getColor: updateTriggers['getOutlineColor'],
                  getWidth: updateTriggers['getWidth']
                }
              })
            )
          );
        }
        layers.push(
          new LineLayer<DataT>(
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
          )
        );
      }
    }

    layers.push(
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
    );

    return layers;
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
