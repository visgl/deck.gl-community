import React, {Component} from 'react';

import GraphGL, {D3ForceLayout, JSONLoader, NODE_TYPE} from 'modules/react-graph-layers';

import SAMPLE_GRAPH_DATASETS from '../../utils/data/sample-datasets';

const DEFAULT_NODE_SIZE = 5;

const DEFAULT_DATASET = 'Random (20, 40)';

class Root extends Component {
  state = {
    selectedDataset: DEFAULT_DATASET
  };

  handleChangeGraph = ({target: {value}}) => this.setState({selectedDataset: value});

  render() {
    const {selectedDataset} = this.state;
    const graphData = SAMPLE_GRAPH_DATASETS[selectedDataset]();
    const graph = JSONLoader({json: graphData});

    return (
      <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
        <div style={{width: '100%', zIndex: 999}}>
          <div>
            Dataset:
            <select value={this.state.selectedDataset} onChange={this.handleChangeGraph}>
              {Object.keys(SAMPLE_GRAPH_DATASETS).map((data) => (
                <option key={data} value={data}>
                  {data}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{width: '100%', flex: 1}}>
          <GraphGL
            graph={graph}
            layout={new D3ForceLayout()}
            nodeStyle={[
              {
                type: NODE_TYPE.CIRCLE,
                radius: DEFAULT_NODE_SIZE,
                fill: 'red'
              }
            ]}
            edgeStyle={{
              stroke: '#000',
              strokeWidth: 1
            }}
          />
        </div>
      </div>
    );
  }
}

export default Root;
