import {COORDINATE_SYSTEM, CompositeLayer} from '@deck.gl/core';

import {EDGE_TYPE} from '../index';
import StraightLineEdge from './edge-layers/straight-line-edge';
import PathEdge from './edge-layers/path-edge';
import CurvedEdge from './edge-layers/curved-edge';

const EDGE_LAYER_MAP = {
  [EDGE_TYPE.LINE]: StraightLineEdge,
  [EDGE_TYPE.PATH]: PathEdge,
  [EDGE_TYPE.SPLINE_CURVE]: CurvedEdge,
};

export default class EdgeLayer extends CompositeLayer {
  static layerName = 'EdgeLayer';

  static defautlProps = {
    data: [],
    pickable: true,
    getLayoutInfo: d => ({
      type: d.type,
      sourcePosition: d.sourcePosition,
      targetPosition: d.targetPosition,
      controlPoints: [],
    }),
    positionUpdateTrigger: 0,
  };

  updateState({props, oldProps, changeFlags}) {
    super.updateState({props, oldProps, changeFlags});
    if (changeFlags.dataChanged) {
      this.updateStateData(props);
    }
  }

  updateStateData() {
    const {data, getLayoutInfo} = this.props;
    // bucket edges by types
    const typedEdgeData = data.reduce(
      (res, d) => {
        const {type} = getLayoutInfo(d);
        res[type] = res[type].concat(d);
        return res;
      },
      {
        [EDGE_TYPE.LINE]: [],
        [EDGE_TYPE.PATH]: [],
        [EDGE_TYPE.SPLINE_CURVE]: [],
      }
    );
    this.setState({typedEdgeData});
  }

  renderLayers() {
    const {
      getLayoutInfo,
      pickable,
      positionUpdateTrigger,
      stylesheet,
    } = this.props;

    const {typedEdgeData} = this.state;

    // render lines by types (straight line, path, curves)
    return Object.entries(typedEdgeData).map(e => {
      const [type, edgeData] = e;
      const Layer = EDGE_LAYER_MAP[type];
      // invalid edge layer type
      if (!Layer) {
        return null;
      }
      return new Layer({
        data: edgeData,
        getLayoutInfo,
        getColor: stylesheet.getDeckGLAccessor('getColor'),
        getWidth: stylesheet.getDeckGLAccessor('getWidth'),
        colorUpdateTrigger: stylesheet.getDeckGLAccessorUpdateTrigger(
          'getColor'
        ),
        widthUpdateTrigger: stylesheet.getDeckGLAccessorUpdateTrigger(
          'getWidth'
        ),
        positionUpdateTrigger,
        pickable,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        parameters: {
          depthTest: false,
        },
      });
    });
  }
}
