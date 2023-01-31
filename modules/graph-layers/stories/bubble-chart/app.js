import React from 'react';
import GraphGL, {D3ForceLayout, createGraph, NODE_TYPE} from '../../src';
import {scaleLinear} from 'd3-scale';
import {extent} from 'd3-array';
import {voronoi} from 'd3-voronoi';

import FeatureData from './data';

function generateGraph({
  points,
  width,
  height,
  xAccessor = d => d.x,
  yAccessor = d => d.y,
  idAccessor = d => d.id,
}) {
  if (!points || !Array.isArray(points) || points.length === 0) {
    return null;
  }

  let edgeCount = 0;

  const links = voronoi()
    .x(xAccessor)
    .y(yAccessor)
    .links(points);

  // expand the graph to screen size
  const originalNodes = points.map(node => ({
    ...node,
    id: idAccessor(node),
    visible: false,
    // set the collisionRadius of original nodes to 0
    // so the fake nodes won't be pushed away from them.
    collisionRadius: 0,
    locked: true,
    x: node.x * width,
    y: node.y * height,
  }));

  const originalEdges = links.map(link => ({
    id: edgeCount++,
    sourceId: idAccessor(link.source),
    targetId: idAccessor(link.target),
    visible: false,
  }));

  const fakeNodes = points.map(node => ({
    ...node,
    id: idAccessor(node) + '-visible',
    // only fake nodes has collision detection
    collisionRadius: 5,
    visible: true,
    locked: false,
  }));

  const fakeEdges = points.map(node => ({
    id: edgeCount++,
    sourceId: idAccessor(node),
    targetId: idAccessor(node) + '-visible',
    visible: true,
  }));
  const Identity = c => c;
  const graph = createGraph({
    name: 'voronoi-graph',
    nodes: originalNodes.concat(fakeNodes),
    edges: originalEdges.concat(fakeEdges),
    nodeParser: Identity,
    edgeParser: Identity,
  });
  return graph;
}

class BubbleChartExample extends React.Component {
  state = {graph: null};

  static defaultProps = {
    opacity: 0.3,
  };

  componentDidMount() {
    const graph = generateGraph({
      points: FeatureData,
      width: 800,
      height: 800,
    });
    this.setState({graph});
    const valueExtent = extent(FeatureData, n => n.value);
    this._nodeSizeScale = scaleLinear()
      .range([5, 15])
      .domain(valueExtent);
  }

  render() {
    if (!this.state.graph) {
      return null;
    }
    const {opacity} = this.props;
    return (
      <GraphGL
        graph={this.state.graph}
        layout={
          new D3ForceLayout({
            nBodyStrength: 10,
            nBodyDistanceMin: 1,
            nBodyDistanceMax: 10,
          })
        }
        nodeStyle={[
          {
            type: NODE_TYPE.MARKER,
            size: d => {
              if (!d.getPropertyValue('visible')) {
                return 5;
              }
              return this._nodeSizeScale(d.getPropertyValue('value'));
            },
            fill: d => {
              return d.getPropertyValue('visible')
                ? 'red'
                : `rgba(0, 0, 255, ${opacity})`;
            },
            marker: 'circle-filled',
            scaleWithZoom: false,
          },
          {
            type: NODE_TYPE.LABEL,
            text: node => node.getId(),
            color: d => (d.getPropertyValue('visible') ? 'red' : 'transparent'),
            fontSize: 3,
            offset: [0, 1],
            scaleWithZoom: true,
          },
        ]}
        enableDragging
        resumeLayoutAfterDragging
        edgeStyle={{
          stroke: d =>
            d.getPropertyValue('visible')
              ? `rgba(255, 0, 0, ${opacity})`
              : `rgba(0, 0, 255, ${opacity})`,
          strokeWidth: 0.3,
        }}
      />
    );
  }
}

export default BubbleChartExample;
