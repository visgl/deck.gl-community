// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {Component} from 'react';
import Color from 'color';

// graph.gl
import GraphGL, {EDGE_DECORATOR_TYPE, JSONLoader, NODE_TYPE} from '@deck.gl-community/graph-layers';
import MultiGraphLayout from './layouts/multi-graph-layout';

// data
import sampleGraph from './sample-multi-graph.json';

const DEFAULT_NODE_SIZE = 30;
const DEFAULT_NODE_PLACEHOLDER_SIZE = 40;
const DEFAULT_NODE_PLACEHOLDER_COLOR = 'rgb(240, 240, 240)';

export default class MultiGraphExample extends Component {
  static defaultProps = {
    showNodePlaceholder: true,
    showNodeCircle: true,
    nodeColor: '#cf4569',
    showNodeLabel: true,
    nodeLabelColor: '#ffffff',
    nodeLabelSize: 14,
    edgeColor: '#cf4569',
    edgeWidth: 2,
    showEdgeLabel: true,
    edgeLabelColor: '#000000',
    edgeLabelSize: 14,
  };

  render() {
    return (
      <GraphGL
        graph={JSONLoader({json: sampleGraph})}
        layout={
          new MultiGraphLayout({
            nBodyStrength: -8000,
          })
        }
        nodeStyle={[
          this.props.showNodePlaceholder && {
            type: NODE_TYPE.CIRCLE,
            radius: DEFAULT_NODE_PLACEHOLDER_SIZE,
            fill: DEFAULT_NODE_PLACEHOLDER_COLOR,
          },
          this.props.showNodeCircle && {
            type: NODE_TYPE.CIRCLE,
            radius: DEFAULT_NODE_SIZE,
            fill: this.props.nodeColor,
          },
          {
            type: NODE_TYPE.CIRCLE,
            radius: node => (node.getPropertyValue('star') ? 6 : 0),
            fill: [255, 255, 0],
            offset: [18, -18],
          },
          this.props.showNodeLabel && {
            type: NODE_TYPE.LABEL,
            text: node => node.getId(),
            color: Color(this.props.nodeLabelColor).array(),
            fontSize: this.props.nodeLabelSize,
          },
        ]}
        edgeStyle={{
          stroke: this.props.edgeColor,
          strokeWidth: this.props.edgeWidth,
          decorators: [
            this.props.showEdgeLabel && {
              type: EDGE_DECORATOR_TYPE.LABEL,
              text: edge => edge.getPropertyValue('type'),
              color: Color(this.props.edgeLabelColor).array(),
              fontSize: this.props.edgeLabelSize,
            },
          ],
        }}
      />
    );
  }
}
