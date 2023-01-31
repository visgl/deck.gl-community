import React, {Component} from 'react';

// graph.gl
import GraphGL, {JSONLoader, NODE_TYPE} from '../../src';
import VizJSLayout from './vizjs-layout';

const DEFAULT_NODE_SIZE = 15;

export default class VizJSExample extends Component {
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
        id: edge.id,
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
        layout={
          new VizJSLayout({
            engine: this.props.selectedEngine,
            orthogonal: this.props.orthogonal,
            leftToRight: this.props.leftToRight,
          })
        }
        nodeEvents={{
          onClick: this.props.onNodeClick,
          draggable: true,
        }}
        nodeStyle={[
          {
            type: NODE_TYPE.CIRCLE,
            radius: DEFAULT_NODE_SIZE,
            fill: 'rbg(100, 100, 100)',
          },
        ]}
        edgeStyle={{
          stroke: 'rgb(120, 120, 120)',
          strokeWidth: 1,
        }}
      />
    );
  }
}
