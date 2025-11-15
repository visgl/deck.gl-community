// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Graph, GraphProps} from './graph';
import  {type GraphData, isArrowGraphData} from '../graph-data/graph-data';
import {ArrowGraph} from './arrow-graph';
import {createTabularGraphFromData} from './create-plain-graph-from-data';

export function createGraphFromData(data: GraphData, props: GraphProps = {}): Graph {
  if (isArrowGraphData(data)) {
    return new ArrowGraph(data, props);
  }

  const graph = createTabularGraphFromData(data);
  graph.setProps(props);
  return graph;
}
