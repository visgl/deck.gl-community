import React from 'react';
import GraphGL, {D3ForceLayout, JSONLoader, NODE_TYPE} from '../../src';

class GraphBuilder extends React.Component {
  state = {graph: null};

  componentDidMount() {
    this.processData(this.props.graph);
  }

  componentWillReceiveProps(nextProps) {
    if (this.props.graph !== nextProps.graph) {
      this.processData(nextProps.graph);
    }
  }

  processData = data => {
    const graph = JSONLoader({
      json: data,
      nodeParser: node => ({id: node.id}),
      edgeParser: edge => ({
        id: Math.random() * 10000,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        directed: true,
      }),
    });
    this.setState({graph});
  };

  render() {
    if (!this.state.graph) {
      return null;
    }
    return (
      <GraphGL
        graph={this.state.graph}
        layout={new D3ForceLayout()}
        nodeEvents={{
          onClick: this.props.onNodeClick,
        }}
        nodeStyle={[
          {
            type: NODE_TYPE.MARKER,
            size: this.props.nodeSize,
            fill: this.props.nodeColor,
            marker: 'circle-filled',

            ':hover': {
              fill: 'red',
            },
          },
          {
            type: NODE_TYPE.LABEL,
            text: node => String(node.id).substring(0, 6),
            color: '#000000',
            fontSize: 15,
            offset: [0, 12],
            scaleWithZoom: true,

            ':hover': {
              color: 'red',
              fontSize: 18,
            },
          },
        ]}
        enableDragging
        edgeEvents={{
          onClick: this.props.onEdgeClick,
        }}
        edgeStyle={{
          stroke: this.props.edgeColor,
          strokeWidth: this.props.edgeWidth,
        }}
      />
    );
  }
}

export default GraphBuilder;
