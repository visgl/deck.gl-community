// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Table} from 'apache-arrow';

export type ArrowGraphData = {
  type?: 'arrow-graph-data';
  version: number;
  nodes: Table;
  edges: Table;
};

export function isArrowGraphData(value: unknown): value is ArrowGraphData {
  const candidate = value as ArrowGraphData;
  return typeof value === 'object' && candidate?.type === 'arrow-graph-data';
}

