// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Graph, GraphProps} from './graph';
import type {GraphData} from '../graph-data/graph-data';
import {type ArrowGraphData, isArrowGraphData} from '../graph-data/arrow-graph-data';
import {ArrowGraph} from './arrow-graph';
import {createTabularGraphFromData} from './create-tabular-graph-from-data';

export function createGraphFromData(data: GraphData | ArrowGraphData, props: GraphProps = {}): Graph {
  if (isArrowGraphData(data)) {
    return new ArrowGraph(data, props);
  }

  const graph = createTabularGraphFromData(data);
  graph.setProps(props);
  return graph;
}
