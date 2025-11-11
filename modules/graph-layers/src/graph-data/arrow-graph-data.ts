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

