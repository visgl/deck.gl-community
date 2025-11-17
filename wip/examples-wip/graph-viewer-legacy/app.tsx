// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {Component} from 'react';
import {createRoot} from 'react-dom/client';

import {D3ForceLayout, JSONLoader} from '@deck.gl-community/graph-layers';
import {GraphViewer} from './react-graph-layers/graph-viewer';

// eslint-disable-next-line import/no-unresolved
import {SAMPLE_GRAPH_DATASETS} from '../../../modules/graph-layers/test/data/graphs/sample-datasets';

const DEFAULT_NODE_SIZE = 5;

const DEFAULT_DATASET = 'Random (20, 40)';

const LAYOUTS = ['D3ForceLayout', 'GPUForceLayout', 'SimpleLayout'];

export class App extends Component {
  state = {
    selectedDataset: DEFAULT_DATASET,
    selectedLayout: DEFAULT_DATASET
  };

  handleChangeGraph = ({target: {value}}) => this.setState({selectedDataset: value});

  handleChangeLayout = ({target: {value}}) => this.setState({selectedLayout: value});

  render() {
    const {selectedDataset} = this.state;
    const graphData = SAMPLE_GRAPH_DATASETS[selectedDataset]();
    const graph = JSONLoader({json: graphData});

    // return (
    //    <div style={{width: '100%', zIndex: 999}}>
    //       <div>
    //         Dataset:
    //         <select value={this.state.selectedDataset} onChange={this.handleChangeGraph}>
    //           {Object.keys(SAMPLE_GRAPH_DATASETS).map((data) => (
    //             <option key={data} value={data}>
    //               {data}
    //             </option>
    //           ))}
    //         </select>
    //       </div>
    //       <div>
    //         Layout:
    //         <select value={this.state.selectedLayout} onChange={this.handleChangeLayout}>
    //           {LAYOUTS.map((data) => (
    //             <option key={data} value={data}>
    //               {data}
    //             </option>
    //           ))}
    //         </select>
    //       </div>
    //     </div>

    return (
      <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
        <div style={{width: '100%', flex: 1}}>
          <GraphViewer
            graph={graph}
            layout={new D3ForceLayout()}
            stylesheet={{
              nodes: [
                {
                  type: 'circle',
                  radius: DEFAULT_NODE_SIZE,
                  fill: 'red'
                }
              ],
              edges: {
                stroke: '#000',
                strokeWidth: 1
              }
            }}
          />
        </div>
      </div>
    );
  }
}

export function renderToDOM() {
  if (document.body) {
    document.body.style.margin = '0';
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(<App />);
  }
}
