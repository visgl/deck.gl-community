import {BaseLayout, EDGE_TYPE} from '../../src';
import NGraph from 'ngraph.graph';
import NGraphForceLayout from 'ngraph.forcelayout';
import raf from 'raf';

const defaultOptions = {
  stableMomemtumDiff: 0.003,
  physicsSetting: {
    springLength: 90,
    springCoeff: 0.0001,
    gravity: -1.2,
    theta: 0.3,
    dragCoeff: 0.01,
    timeStep: 20,
  },
};

export default class NGraphLayout extends BaseLayout {
  constructor(options) {
    super(options);
    this._name = 'NGraphLayout';
    this._options = {
      ...defaultOptions,
      ...options,
    };
    // custom layout data structure
    this._ngraph = NGraph();
    this._lastMomemtum = 0;
    // initialize layout engine
    this._simulator = NGraphForceLayout(
      this._ngraph,
      this._options.physicsSetting
    );
  }

  _ticked = () => {
    this._lastMomemtum = this._simulator.lastMove;
    if (this._onUpdate) {
      this._onUpdate();
    }
  };

  registerCallbacks({onLayoutChange}) {
    this._onUpdate = onLayoutChange;
  }

  unregisterCallbacks() {
    this._simulator.dispose();
    this._onUpdate = null;
    this._onDone = null;
  }

  _frame = () => {
    this._simulator.step();
    // check if the layout is stable
    const {stableMomemtumDiff} = this._options;
    const momemtumDiff = Math.abs(
      this._simulator.lastMove - this._lastMomemtum
    );
    const isStable = momemtumDiff <= stableMomemtumDiff;
    // trigger callbacks
    this._ticked();

    if (!isStable) {
      // request animation frame
      raf(this._frame);
    }
  };

  start() {
    if (this._ngraph.getNodesCount() === 0) {
      return;
    }
    // request animation frame
    raf(this._frame);
  }

  resume() {
    this.start();
  }

  stop() {}

  initializeGraph(graph) {
    this._ngraph.clear();
    // add new nodes
    graph.getNodes().forEach(node => {
      this._ngraph.addNode(node.getId());
      // set to origin
      // this._simulator.setNodePosition(node.getId(), 0, 0);
    });
    graph.getEdges().forEach(edge => {
      this._ngraph.addLink(
        edge.getSourceNodeId(),
        edge.getTargetNodeId(),
        edge.getId()
      );
    });
  }

  updateGraph(graph) {
    const _ngraph = this._ngraph;
    // remove non-exist node
    _ngraph.forEachNode(nNode => {
      const node = graph.findNode(nNode.id);
      if (!node) {
        _ngraph.removeNode(nNode.id);
      }
    });
    // add new nodes
    graph.getNodes().forEach(node => {
      const nNode = _ngraph.getNode(node.getId());
      if (!nNode) {
        // add new node
        _ngraph.addNode(node.getId());
        // set to origin
        this._simulator.setNodePosition(node.getId(), 0, 0);
      }
    });

    // remove non-exist edge
    _ngraph.forEachLink(nEdge => {
      const edgeId = nEdge.data;
      if (!graph.findEdge(edgeId)) {
        _ngraph.removeLink(nEdge);
      }
    });
    graph.getEdges().forEach(edge => {
      const nEdge = _ngraph.getLink(
        edge.getSourceNodeId(),
        edge.getTargetNodeId()
      );
      if (!nEdge) {
        // add new edge
        _ngraph.addLink(
          edge.getSourceNodeId(),
          edge.getTargetNodeId(),
          edge.getId()
        );
      }
    });
  }

  getNodePosition = node => {
    const nNodePos = this._simulator.getNodePosition(node.id);
    return [nNodePos.x, nNodePos.y];
  };

  getEdgePosition = edge => {
    const sourceNodePos = this._simulator.getNodePosition(
      edge.getSourceNodeId()
    );
    const targetNodePos = this._simulator.getNodePosition(
      edge.getTargetNodeId()
    );
    return {
      type: EDGE_TYPE.LINE,
      sourcePosition: [sourceNodePos.x, sourceNodePos.y],
      targetPosition: [targetNodePos.x, targetNodePos.y],
      controlPoints: [],
    };
  };
}
