import {COORDINATE_SYSTEM, CompositeLayer} from '@deck.gl/core';
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

export default class SplineLayer extends CompositeLayer {
  static layerName = 'SplineLayer';

  initializeState() {
    this.state = {typedEdgeData: []};
  }

  shouldUpdateState({changeFlags}) {
    return changeFlags.dataChanged || changeFlags.propsChanged;
  }

  updateState({props, oldProps, changeFlags}) {
    super.updateState({props, oldProps, changeFlags});
    if (changeFlags.dataChanged || changeFlags.propsChanged) {
      this.updateSplineData(props);
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
      data: paths,
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
