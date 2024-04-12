import {CompositeLayer} from '@deck.gl/core';
import {ScatterplotLayer, LineLayer} from '@deck.gl/layers';
import {SplineLayer} from '../common-layers/spline-layer/spline-layer';

const DEBUG = false;

export class CurvedEdgeLayer extends CompositeLayer {
  static layerName = 'CurvedEdgeLayer';

  renderLayers() {
    const {
      data,
      getLayoutInfo,
      positionUpdateTrigger = 0,
      colorUpdateTrigger = 0,
      widthUpdateTrigger = 0,
      ...otherProps
    } = this.props;
    return [
      DEBUG &&
        new ScatterplotLayer(
          this.getSubLayerProps({
            id: '__control-points',
            data,
            getPosition: (e) => getLayoutInfo(e).controlPoints[0],
            getColor: (d) => [190, 190, 190, 150],
            getRadius: (d) => 5,
            updateTriggers: {
              getPosition: positionUpdateTrigger
            },
            ...otherProps
          })
        ),
      DEBUG &&
        new LineLayer(
          this.getSubLayerProps({
            id: '__first_segment',
            data,
            getSourcePosition: (e) => getLayoutInfo(e).sourcePosition,
            getTargetPosition: (e) => getLayoutInfo(e).controlPoints[0],
            getColor: (e) => [210, 210, 210, 150],
            updateTriggers: {
              getSourcePosition: positionUpdateTrigger,
              getTargetPosition: positionUpdateTrigger
            },
            ...otherProps
          })
        ),
      DEBUG &&
        new LineLayer(
          this.getSubLayerProps({
            id: '__last_segment',
            data,
            getSourcePosition: (e) => getLayoutInfo(e).controlPoints[0],
            getTargetPosition: (e) => getLayoutInfo(e).targetPosition,
            getColor: (e) => [210, 210, 210, 150],
            updateTriggers: {
              getSourcePosition: positionUpdateTrigger,
              getTargetPosition: positionUpdateTrigger
            },
            ...otherProps
          })
        ),
      new SplineLayer(
        this.getSubLayerProps({
          id: '__spline_layer',
          data,
          getSourcePosition: (e) => getLayoutInfo(e).sourcePosition,
          getTargetPosition: (e) => getLayoutInfo(e).targetPosition,
          getControlPoints: (e) => getLayoutInfo(e).controlPoints,
          updateTriggers: {
            getSourcePosition: positionUpdateTrigger,
            getTargetPosition: positionUpdateTrigger,
            getControlPoints: positionUpdateTrigger,
            getColor: colorUpdateTrigger,
            getWidth: widthUpdateTrigger
          },
          ...otherProps
        })
      )
    ];
  }
}
