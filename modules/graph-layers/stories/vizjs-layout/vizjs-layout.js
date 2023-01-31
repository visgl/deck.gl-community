const Viz = require('viz.js').default;
const {Module, render} = require('viz.js/full.render.js');
import {extent} from 'd3-array';
import {BaseLayout, EDGE_TYPE} from '../../src';

const defaultOptions = {
  // engines supported by graphviz. Available engine:
  // "circo", "dot", "fdp", "neato", "osage", or "twopi".
  // https://github.com/mdaines/viz.js/wiki/API-(1.x)
  engine: 'dot',
  // Set edge routing to orthogonal or not.
  orthogonal: false,
  // set the direction of the layout to 'Left to Right',
  // default is "Top to Bottom"
  leftToRight: false,
};

export default class VizJSLayout extends BaseLayout {
  constructor(options) {
    super(options);
    this._name = 'Viz.js';
    this._options = {
      ...defaultOptions,
      ...options,
    };
    this._viz = new Viz({Module, render});
    this._dotGraph = 'graph {}';
    this._nodeMap = {};
    this._edgeMap = {};
  }

  setOptions(options) {
    this._options = {...this._options, ...options};
  }

  _buildDotGraphSetting(options) {
    const graphSetting = {
      nodesep: 0.5,
      rankdir: options.leftToRight ? 'LR' : 'TB',
      sep: 0.5,
      splines: options.orthogonal ? 'ortho' : 'line',
    };
    const nodeSetting = {
      shape: 'circle',
      fixedsize: 'true',
      width: 0.05,
      label: '""',
      color: '"_"',
      fillcolor: '"_"',
    };
    const edgeSetting = {
      arrowhead: 'none',
      arrowtail: 'none',
    };
    const serializeSetting = setting =>
      Object.entries(setting)
        .map(p => p.join('='))
        .join(', ');
    return [
      `graph[${serializeSetting(graphSetting)}]`,
      `node[${serializeSetting(nodeSetting)}]`,
      `edge[${serializeSetting(edgeSetting)}]`,
    ];
  }

  _buildDotEdges(edges) {
    return edges.map(
      e => `"${e.getSourceNodeId()}" -- "${e.getTargetNodeId()}"`
    );
  }

  _convertDotGraph(graph) {
    this._dotGraph = [
      'graph G {',
      ...this._buildDotGraphSetting(this._options),
      ...this._buildDotEdges(graph.getEdges()),
      '}',
    ]
      .filter(Boolean)
      .join(' ');
    let idx = 0;
    // nodeIndexMap: key = index, value = node ID.
    this._nodeIndexMap = graph.getEdges().reduce((res, e) => {
      const sourceId = e.getSourceNodeId();
      const targetId = e.getTargetNodeId();
      if (!Object.values(res).includes(sourceId)) {
        res[idx++] = sourceId;
      }
      if (!Object.values(res).includes(targetId)) {
        res[idx++] = targetId;
      }
      return res;
    }, {});
    // build a special edge map [source-target] = edge
    this._edgeEndPointsMap = {};
    graph.getEdges().forEach(e => {
      this._edgeEndPointsMap[
        `"${e.getSourceNodeId()}" -- "${e.getTargetNodeId()}"`
      ] = e.id;
    });
  }

  _getEdgeIdFromEndPoints(sourceIdx, targetIdx) {
    const sourceId = this._nodeIndexMap[sourceIdx];
    const targetId = this._nodeIndexMap[targetIdx];
    const edgeId = this._edgeEndPointsMap[`"${sourceId}" -- "${targetId}"`];
    return edgeId;
  }

  _notifyLayoutComplete() {
    this._callbacks.onLayoutChange();
    this._callbacks.onLayoutDone();
  }

  initializeGraph(graph) {
    this._nodeMap = {};
    this._edgeMap = {};
    this._convertDotGraph(graph);
  }

  start() {
    this._viz
      .renderString(this._dotGraph, {format: 'json', ...this._options})
      .then(string => {
        const result = JSON.parse(string);
        const {objects} = result;
        objects.forEach(obj => {
          this._nodeMap[obj.name] = obj.pos.split(',').map(v => parseFloat(v));
        });

        // Flip the entire graph vertically
        // and shift to the center
        const xExtent = extent(Object.values(this._nodeMap), p => p[0]);
        const yExtent = extent(Object.values(this._nodeMap), p => p[1]);
        const center = [
          (xExtent[0] + xExtent[1]) / 2,
          (yExtent[0] + yExtent[1]) / 2,
        ];
        Object.keys(this._nodeMap).forEach(k => {
          const oldPos = this._nodeMap[k];
          this._nodeMap[k] = [oldPos[0] - center[0], -oldPos[1] + center[1]];
        });

        const {edges} = result;
        edges.forEach(e => {
          // e. head tail
          const {head, tail, _draw_} = e;
          const edgeId = this._getEdgeIdFromEndPoints(tail, head);
          const points = _draw_.find(d => d.op === 'b').points;
          this._edgeMap[edgeId] = points.map(p => [
            p[0] - center[0],
            -p[1] + center[1],
          ]);
        });
        this._notifyLayoutComplete();
      });
  }

  updateGraph(graph) {
    this.initializeGraph(graph);
  }

  getNodePosition = node => {
    const nodePos = this._nodeMap[node.id];
    if (nodePos) {
      return nodePos;
    }
    return [0, 0];
  };

  getEdgePosition = edge => {
    const sourcePosition = this._nodeMap[edge.getSourceNodeId()];
    const targetPosition = this._nodeMap[edge.getTargetNodeId()];
    if (sourcePosition && targetPosition) {
      return {
        type: EDGE_TYPE.PATH,
        sourcePosition,
        targetPosition,
        controlPoints: this._edgeMap[edge.id] || [],
      };
    }
    return {
      type: EDGE_TYPE.LINE,
      sourcePosition: [0, 0],
      targetPosition: [0, 0],
      controlPoints: [],
    };
  };

  lockNodePosition = (node, x, y) => {
    this._nodeMap[node.id] = [x, y];
    this._callbacks.onLayoutChange();
    this._callbacks.onLayoutDone();
  };
}
