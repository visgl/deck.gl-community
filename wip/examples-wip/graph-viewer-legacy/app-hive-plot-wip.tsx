// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {Component} from 'react';
import {scaleOrdinal} from 'd3-scale';
import {schemeAccent} from 'd3-scale-chromatic';
import {extent} from 'd3-array';
import Color from 'color';
import {fetchJSONFromS3} from '../../utils/data/io';

import {JSONLoader} from '../../src';
import {GraphViewer} from './react-graph-layers/graph-viewer';
import HivePlot from './hive-plot-layout';

const DEFAULT_NODE_SIZE = 3;
const DEFAULT_EDGE_COLOR = 'rgba(80, 80, 80, 0.3)';
const DEFAULT_EDGE_WIDTH = 1;
const DEFAULT_WIDTH = 1000;

export default class HivePlotExample extends Component {
  state = {graph: null};

  componentDidMount() {
    fetchJSONFromS3(['wits.json']).then(([sampleGraph]) => {
      const {nodes} = sampleGraph;
      const nodeIndexMap = nodes.reduce((res, node, idx) => {
        res[idx] = node.name;
        return res;
      }, {});
      const graph = JSONLoader({
        json: sampleGraph,
        nodeParser: node => ({id: node.name}),
        edgeParser: edge => ({
          id: `${edge.source}-${edge.target}`,
          sourceId: nodeIndexMap[edge.source],
          targetId: nodeIndexMap[edge.target],
          directed: true,
        }),
      });
      this.setState({graph});
      const groupExtent = extent(nodes, n => n.group);
      this._nodeColorScale = scaleOrdinal(schemeAccent).domain(groupExtent);
    });
  }

  // node accessors
  getNodeColor = node => {
    const hex = this._nodeColorScale(node.getPropertyValue('group'));
    return Color(hex).array();
  };

  render() {
    if (!this.state.graph) {
      return null;
    }
    return (
      <GraphViewer
        graph={this.state.graph}
        layout={
          new HivePlot({
            innerRadius: DEFAULT_WIDTH * 0.05,
            outerRadius: DEFAULT_WIDTH * 0.3,
            getNodeAxis: node => node.getPropertyValue('group'),
          })
        }
        stylesheet={{
          nodes: [
            {
              type: 'circle',
              radius: DEFAULT_NODE_SIZE,
              fill: this.getNodeColor,
            },
          ],
          edges: {
            stroke: DEFAULT_EDGE_COLOR,
            strokeWidth: DEFAULT_EDGE_WIDTH,
          }
        }}
      />
    );
  }
}
