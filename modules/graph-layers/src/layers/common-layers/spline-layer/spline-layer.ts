// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  COORDINATE_SYSTEM,
  CompositeLayer,
  type CompositeLayerProps,
  type Accessor,
  type AccessorFunction,
  type UpdateParameters
} from '@deck.gl/core';
import {PathLayer} from '@deck.gl/layers';
import {getCurvePoints} from 'cardinal-spline-js';
// const getCurvePoints = () => {};

/* Constants */
const defaultProps = {
  id: 'spline-layer',
  getData: (d) => d.points,
  getAngle: (x) => 0,
  fontSize: 24,
  coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
  fp64: false
};

/** Props for the {@link SplineLayer} composite layer. */
export type SplineLayerProps<DatumT = unknown> = CompositeLayerProps & {
  /** Items that contain curve control data. */
  data: readonly DatumT[];
  /** Accessor resolving the curve source position. */
  getSourcePosition: AccessorFunction<DatumT, readonly number[]>;
  /** Accessor resolving the curve target position. */
  getTargetPosition: AccessorFunction<DatumT, readonly number[]>;
  /** Accessor resolving intermediate spline control points. */
  getControlPoints: AccessorFunction<DatumT, readonly number[][]>;
  /** Accessor resolving the RGBA stroke color. */
  getColor: Accessor<DatumT, readonly number[]>;
  /** Accessor resolving the curve width. */
  getWidth: Accessor<DatumT, number>;
  /** Parameters used to control Deck.gl update triggers. */
  updateTriggers: Record<string, unknown>;
  /** Coordinate system used for rendering. */
  coordinateSystem?: number;
};

type SplineLayerState = {
  paths: number[][][];
};

export class SplineLayer<DatumT = unknown> extends CompositeLayer<SplineLayerProps<DatumT>> {
  static layerName = 'SplineLayer';

  declare state: SplineLayerState;

  initializeState() {
    this.state = {paths: []};
  }

  shouldUpdateState({changeFlags}) {
    return changeFlags.dataChanged || changeFlags.propsChanged;
  }

  updateState({props, oldProps, changeFlags}: UpdateParameters<SplineLayerProps<DatumT>>) {
    super.updateState({props, oldProps, changeFlags});
    if (changeFlags.dataChanged || changeFlags.propsChanged) {
      this.updateSplineData();
    }
  }

  updateSplineData() {
    const {data} = this.props;
    const paths = data.reduce((res, d) => {
      const sourcePosition = this.props.getSourcePosition(d);
      const targetPosition = this.props.getTargetPosition(d);
      const controlPoints = this.props.getControlPoints(d);

      // Catmull-Rom curve
      const serializedControlPoints = controlPoints.toString().split(',');

      // NOTE: we might change the number of points according to the length.
      // so we can render less segements.
      // points = [x1, y1, x2, y2, ...];
      const points = getCurvePoints(
        [...sourcePosition, ...serializedControlPoints, ...targetPosition],
        0.5,
        10
      );
      // convert points to [[x1, y1], [x2, y2], ...]
      const path = [];
      for (let idx = 0; idx < points.length; idx += 2) {
        path.push([points[idx], points[idx + 1]]);
      }
      res.push(path);
      return res;
    }, []);
    this.setState({paths});
  }

  renderLayers() {
    const {coordinateSystem, getColor, getWidth, id, updateTriggers} = this.props;
    const {paths} = this.state;
    return new PathLayer({
      id: `${id}-splines`,
      data: paths as any,
      getPath: (d) => d,
      getColor,
      getWidth,
      coordinateSystem,
      updateTriggers
    });
  }
}

SplineLayer.layerName = 'SplineLayer';
SplineLayer.defaultProps = defaultProps;
