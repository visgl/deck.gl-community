import {COORDINATE_SYSTEM, CompositeLayer} from '@deck.gl/core';

import {EDGE_TYPE} from '../core/constants';
import {StraightLineEdgeLayer} from '../layers/edge-layers/straight-line-edge-layer';
import {PathEdgeLayer} from './edge-layers/path-edge-layer';
import {CurvedEdgeLayer} from './edge-layers/curved-edge-layer';

const EDGE_LAYER_MAP = {
  [EDGE_TYPE.LINE]: StraightLineEdgeLayer,
  [EDGE_TYPE.PATH]: PathEdgeLayer,
  [EDGE_TYPE.SPLINE_CURVE]: CurvedEdgeLayer
};

export class EdgeLayer extends CompositeLayer {
  static layerName = 'EdgeLayer';

  static defaultProps = {
    data: [],
    pickable: true,
    getLayoutInfo: (d) => ({
      type: d.type,
      sourcePosition: d.sourcePosition,
      targetPosition: d.targetPosition,
      controlPoints: []
    }),
    positionUpdateTrigger: 0
  };

  updateState({props, oldProps, changeFlags}) {
    super.updateState({props, oldProps, changeFlags} as any);
    if (changeFlags.dataChanged) {
      this.updateStateData();
    }
  }

  updateStateData() {
    const {data, getLayoutInfo} = this.props as any;
    // bucket edges by types
    const typedEdgeData = data.reduce(
      (res, d) => {
        const {type} = getLayoutInfo(d);
        res[type].push(d);
        return res;
      },
      {
        [EDGE_TYPE.LINE]: [],
        [EDGE_TYPE.PATH]: [],
        [EDGE_TYPE.SPLINE_CURVE]: []
      }
    );
    this.setState({typedEdgeData});
  }

  renderLayers() {
    const {getLayoutInfo, pickable, positionUpdateTrigger, stylesheet, id} = this.props as any;

    const {typedEdgeData} = this.state;

    // render lines by types (straight line, path, curves)
    return Object.entries(typedEdgeData).map((e, idx) => {
      const [type, edgeData] = e;
      const Layer = EDGE_LAYER_MAP[type];
      // invalid edge layer type
      if (!Layer) {
        return null;
      }
      return new Layer({
        id: `${id}-${idx}`,
        data: edgeData,
        getLayoutInfo,
        getColor: stylesheet.getDeckGLAccessor('getColor'),
        getWidth: stylesheet.getDeckGLAccessor('getWidth'),
        colorUpdateTrigger: stylesheet.getDeckGLAccessorUpdateTrigger('getColor'),
        widthUpdateTrigger: stylesheet.getDeckGLAccessorUpdateTrigger('getWidth'),
        positionUpdateTrigger,
        pickable,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        parameters: {
          depthCompare: 'always'
        }
      } as any);
    });
  }
}
