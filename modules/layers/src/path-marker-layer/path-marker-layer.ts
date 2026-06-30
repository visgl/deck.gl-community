// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Accessor, Color, DefaultProps, Position, UpdateParameters} from '@deck.gl/core';
import {CompositeLayer, COORDINATE_SYSTEM} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {GeometryLayer} from '../dependency-arrow-layer/geometry-layer';
import {PathOutlineLayer, PathOutlineLayerProps} from '../path-outline-layer/path-outline-layer';
import {Arrow2DGeometry} from './arrow-2d-geometry';

import {createPathMarkers, PathMarkerDirection} from './create-path-markers';
import {getClosestPointOnPolyline} from './polyline';
import {Vector3} from '@math.gl/core';

const DISTANCE_FOR_MULTI_ARROWS = 160;
const DEFAULT_MARKER_SIZE: [number, number] = [0.28, 0.18];
const DEFAULT_MARKER_LAYER = GeometryLayer;

export type PathMarkerLayerProps<DataT> = PathOutlineLayerProps<DataT> & {
  /** Accessor returning marker direction flags for one path. */
  getDirection?: (datum: DataT, context: {index: number}) => PathMarkerDirection | null | undefined;
  /** Accessor returning marker color. */
  getMarkerColor?: Accessor<DataT, Color>;
  /** Accessor returning the default marker outline color. */
  getMarkerOutlineColor?: Accessor<DataT, Color>;
  /** Accessor returning marker placements along the path, from 0 at start to 1 at end. */
  getMarkerPercentages?: (datum: DataT, info: {index: number; lineLength: number}) => number[];
  /** Accessor returning marker size in local `[length, width]` units. */
  getMarkerSize?: Accessor<DataT, [number, number]>;
  highlightPoint?: any;
  highlightIndex?: number;
  MarkerLayer?: any;
  markerLayerProps?: any;
  /** Scale applied to the default marker outline underlay. */
  markerOutlineWidthScale?: number;
  sizeScale?: number;
  fp64?: boolean;
  nebulaLayer?: any;
};

const defaultProps: DefaultProps<PathMarkerLayerProps<any>> = Object.assign(
  {},
  PathOutlineLayer.defaultProps,
  {
    MarkerLayer: DEFAULT_MARKER_LAYER,
    markerLayerProps: {},

    sizeScale: 100,
    fp64: false,

    highlightIndex: -1,
    highlightPoint: null,

    getPath: x => x.path,
    getColor: x => x.color,
    getMarkerColor: () => [0, 0, 0, 255] as Color,
    getMarkerOutlineColor: () => [255, 255, 255, 220] as Color,
    getMarkerSize: DEFAULT_MARKER_SIZE,
    markerOutlineWidthScale: 1.2,
    getDirection: x => x.direction,
    getMarkerPercentages: (object, {lineLength}) =>
      lineLength > DISTANCE_FOR_MULTI_ARROWS ? [0.25, 0.5, 0.75] : [0.5]
  }
);

export class PathMarkerLayer<
  DataT = any,
  ExtraPropsT = Record<string, unknown>
> extends CompositeLayer<ExtraPropsT & Required<PathMarkerLayerProps<DataT>>> {
  static layerName = 'PathMarkerLayer';
  static defaultProps = defaultProps;

  state: {
    closestPoint: Vector3 | null;
    closestPoints?: {position: Vector3}[];
    markers: any[];
    mesh: Arrow2DGeometry;
  } = undefined!;

  initializeState() {
    this.state = {
      markers: [],
      mesh: new Arrow2DGeometry(),
      closestPoint: null,
      closestPoints: []
    };
  }

  projectFlat(xyz: Position, viewport, coordinateSystem, coordinateOrigin) {
    if (coordinateSystem === COORDINATE_SYSTEM.METER_OFFSETS) {
      const [dx, dy] = viewport.metersToLngLatDelta(xyz);
      const [x, y] = coordinateOrigin;
      return viewport.projectFlat([x + dx, dy + y]);
    } else if (coordinateSystem === COORDINATE_SYSTEM.LNGLAT_OFFSETS) {
      const [dx, dy] = xyz;
      const [x, y] = coordinateOrigin;
      return viewport.projectFlat([x + dx, dy + y]);
    }

    return viewport.projectFlat(xyz);
  }

  updateState({props, oldProps, changeFlags}: UpdateParameters<this>) {
    if (
      changeFlags.dataChanged ||
      changeFlags.updateTriggersChanged ||
      changeFlags.viewportChanged
    ) {
      const {
        data,
        getPath,
        getDirection,
        getMarkerColor,
        getMarkerPercentages,
        coordinateSystem,
        coordinateOrigin
      } = this.props;

      const {viewport} = this.context;
      const projectFlat = o => this.projectFlat(o, viewport, coordinateSystem, coordinateOrigin);
      this.state.markers = createPathMarkers({
        data: data as Iterable<DataT>,
        getPath: getPath as any,
        getDirection,
        getColor: getMarkerColor as any,
        getMarkerPercentages,
        projectFlat
      });
      this._recalculateClosestPoint();
    }
    if (changeFlags.propsChanged) {
      if (props.highlightPoint !== oldProps.highlightPoint) {
        this._recalculateClosestPoint();
      }
    }
  }

  _recalculateClosestPoint() {
    const {highlightPoint, highlightIndex} = this.props;
    if (highlightPoint && highlightIndex >= 0) {
      const object = this.props.data[highlightIndex];
      const points = this.props.getPath(object, null as any);
      const {point} = getClosestPointOnPolyline({points, p: highlightPoint});
      this.state.closestPoints = [{position: point}];
    } else {
      this.state.closestPoints = [];
    }
  }

  getPickingInfo({info}) {
    return Object.assign(info, {
      // override object with picked feature
      object: (info.object && info.object.path) || info.object
    });
  }

  renderLayers() {
    const shouldRenderDefaultMarkerOutline =
      this.props.MarkerLayer === DEFAULT_MARKER_LAYER && this.props.markerOutlineWidthScale > 1;
    const markerLayerProps = Object.assign(
      {
        markerAnchor: 'center'
      },
      this.props.markerLayerProps,
      {
        data: this.state.markers,
        mesh: this.state.mesh,
        sizeUnits: 'pixels',
        getOrientation: x => [0, -x.angle, 0],
        getSourcePosition: x => x.source,
        getTargetPosition: x => x.target,
        getPositionRatio: x => x.percentage,
        getSize: this.getSubLayerAccessor(this.props.getMarkerSize),
        fp64: this.props.fp64,
        pickable: false,
        parameters: {
          depthCompare: 'always',
          depthWriteEnabled: false
        }
      }
    );

    const layers: any[] = [
      new PathOutlineLayer(
        this.props,
        this.getSubLayerProps({
          id: 'paths',
          // Note: data has to be passed explicitly like this to avoid being empty
          data: this.props.data
        })
      )
    ];

    if (shouldRenderDefaultMarkerOutline) {
      layers.push(
        new this.props.MarkerLayer(
          this.getSubLayerProps(
            Object.assign({}, markerLayerProps, {
              id: 'marker-outlines',
              getColor: this.getSubLayerAccessor(this.props.getMarkerOutlineColor),
              sizeScale: this.props.sizeScale * this.props.markerOutlineWidthScale
            })
          )
        )
      );
    }

    layers.push(
      new this.props.MarkerLayer(
        this.getSubLayerProps(
          Object.assign({}, markerLayerProps, {
            id: 'markers',
            getColor: x => x.color,
            sizeScale: this.props.sizeScale
          })
        )
      )
    );

    if (this.state.closestPoints) {
      layers.push(
        new ScatterplotLayer({
          id: `${this.props.id}-highlight`,
          data: this.state.closestPoints,
          fp64: this.props.fp64
        })
      );
    }

    return layers;
  }
}
