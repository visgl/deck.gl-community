// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {Component} from 'react';
import {createRoot} from 'react-dom/client';

import {D3ForceLayout, JSONLoader, NODE_TYPE} from '@deck.gl-community/graph-layers';
import {GraphGL} from './react-graph-layers/graph-gl';

// eslint-disable-next-line import/no-unresolved
import {SAMPLE_GRAPH_DATASETS} from '../../../modules/graph-layers/test/data/graphs/sample-datasets';

const DEFAULT_NODE_SIZE = 5;

const DEFAULT_DATASET = 'Random (20, 40)';

export class App extends Component {
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

if (document.body) {
  document.body.style.margin = '0';
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(<App />);
}

