// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  COORDINATE_SYSTEM,
  CompositeLayer,
  type CompositeLayerProps,
  type Accessor,
  type AccessorContext,
  type AccessorFunction,
  type Color,
  type UpdateParameters
} from '@deck.gl/core';
import {PathLayer} from '@deck.gl/layers';
import {getCurvePoints} from 'cardinal-spline-js';
// const getCurvePoints = () => {};

type CompositeUpdateParameters<PropsT> = UpdateParameters<CompositeLayer<PropsT>>;

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
  getColor: Accessor<DatumT, Color | Color[]>;
  /** Accessor resolving the curve width. */
  getWidth: Accessor<DatumT, number>;
  /** Parameters used to control Deck.gl update triggers. */
  updateTriggers: Record<string, unknown>;
  /** Coordinate system used for rendering. */
  coordinateSystem?: number;
};

type SplinePath<DatumT> = {
  datum: DatumT;
  index: number;
  path: Float64Array;
};

type SplineLayerState<DatumT> = {
  paths: SplinePath<DatumT>[];
};

export class SplineLayer<DatumT = unknown> extends CompositeLayer<SplineLayerProps<DatumT>> {
  static layerName = 'SplineLayer';

  declare state: SplineLayerState<DatumT>;

  initializeState() {
    this.state = {paths: []};
  }

  shouldUpdateState({changeFlags}: CompositeUpdateParameters<SplineLayerProps<DatumT>>) {
    return Boolean(changeFlags.dataChanged || changeFlags.propsChanged);
  }

  updateState(
    params: CompositeUpdateParameters<SplineLayerProps<DatumT>>
  ) {
    super.updateState(params as UpdateParameters<CompositeLayer<any>>);
    const {changeFlags} = params;
    if (changeFlags.dataChanged || changeFlags.propsChanged) {
      this.updateSplineData();
    }
  }

  updateSplineData() {
    const {data, getControlPoints, getSourcePosition, getTargetPosition} = this.props;
    const paths = data.map<SplinePath<DatumT>>((datum, index) => {
      const accessorContext: AccessorContext<DatumT> = {index, data, target: [] as number[]};
      const sourcePosition = getSourcePosition(datum, accessorContext);
      const targetPosition = getTargetPosition(datum, accessorContext);
      const controlPoints = getControlPoints(datum, accessorContext);

      const serializedControlPoints = controlPoints.flat();

      const curvePoints = getCurvePoints(
        [...sourcePosition, ...serializedControlPoints, ...targetPosition],
        0.5,
        10
      );

      return {
        datum,
        index,
        path: Float64Array.from(curvePoints)
      };
    });
    this.setState({paths});
  }

  renderLayers() {
    const {coordinateSystem, data, getColor, getWidth, id, updateTriggers} = this.props;
    const {paths} = this.state;
    return new PathLayer<SplinePath<DatumT>>({
      id: `${id}-splines`,
      data: paths,
      getPath: ({path}) => path,
      getColor: (item, objectInfo) => {
        if (typeof getColor === 'function') {
          const accessorContext: AccessorContext<DatumT> = {
            index: item.index,
            data,
            target: (objectInfo.target as number[]) ?? []
          };
          return getColor(item.datum, accessorContext);
        }
        return getColor;
      },
      getWidth: (item, objectInfo) => {
        if (typeof getWidth === 'function') {
          const accessorContext: AccessorContext<DatumT> = {
            index: item.index,
            data,
            target: (objectInfo.target as number[]) ?? []
          };
          return getWidth(item.datum, accessorContext);
        }
        return getWidth;
      },
      coordinateSystem,
      updateTriggers
    });
  }
}

SplineLayer.layerName = 'SplineLayer';
SplineLayer.defaultProps = defaultProps;
