// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {Component} from 'react';
import {scaleOrdinal} from 'd3-scale';
import {schemeAccent} from 'd3-scale-chromatic';
import {extent} from 'd3-array';
import Color from 'color';

// data
import {fetchJSONFromS3} from './io';

// graph.gl
import GraphGL, {JSONLoader} from '@deck.gl-community/graph-layers';
import RadialLayout from './layouts/radial-layout';

const DEFAULT_NODE_SIZE = 5;
const DEFAULT_NODE_LABEL_COLOR = '#646464';
const DEFAULT_EDGE_COLOR = 'rgba(80, 80, 80, 0.3)';
const RADIUS = 150;

export default class BasicRadialExample extends Component {
  state = {graph: null, tree: null};

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
      this.setState({graph, tree: sampleGraph.tree});
      // parse attributes
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
      <GraphGL
        graph={this.state.graph}
        layout={
          new RadialLayout({
            tree: this.state.tree,
            radius: RADIUS,
          })
        }
        nodeStyle={[
          {
            type: 'circle',
            radius: DEFAULT_NODE_SIZE,
            fill: this.getNodeColor,
          },
          {
            type: 'label',
            text: node => node.getPropertyValue('name'),
            color: DEFAULT_NODE_LABEL_COLOR,
            textAnchor: 'start',
            fontSize: 8,
            // TODO: figure out how to get node position without engine
            // angle: n => {
            //   const nodePos = this._engine.getNodePosition(n);
            //   return (Math.atan2(nodePos[1], nodePos[0]) * -180) / Math.PI;
            // },
          },
        ]}
        edgeStyle={{
          stroke: DEFAULT_EDGE_COLOR,
          strokeWidth: 1,
        }}
      />
    );
  }
}
