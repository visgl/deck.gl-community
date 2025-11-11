// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Graph, GraphProps} from './graph';
import type {GraphData} from '../graph-data/graph-data';
import type {ColumnarGraphColumns} from '../graph-data/columnar-graph-data-builder';
import type {ArrowGraphData} from '../graph-data/arrow-graph-data';
import {ArrowGraph} from './arrow-graph';
import {createTabularGraphFromData} from './create-tabular-graph-from-data';

export type GraphInputData = GraphData | ColumnarGraphColumns | ArrowGraphData;

export function createGraphFromData(data: GraphInputData, props: GraphProps = {}): Graph {
  if (isArrowGraphData(data)) {
    return new ArrowGraph(data, props);
  }

  const graph = createTabularGraphFromData(data);
  graph.setProps(props);
  return graph;
}

function isArrowGraphData(value: GraphInputData): value is ArrowGraphData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as ArrowGraphData;
  if (candidate.type === 'arrow-graph-data') {
    return true;
  }

  const nodes = candidate.nodes as Record<string, unknown> | undefined;
  const edges = candidate.edges as Record<string, unknown> | undefined;
  const hasArrowAccessors = (table: Record<string, unknown> | undefined) =>
    Boolean(
      table &&
      (typeof (table as {getColumn?: unknown}).getColumn === 'function' ||
        typeof (table as {getChild?: unknown}).getChild === 'function' ||
        typeof (table as {getChildAt?: unknown}).getChildAt === 'function')
    );

  return hasArrowAccessors(nodes) && hasArrowAccessors(edges);
}

