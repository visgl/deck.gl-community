// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {createGraph} from './create-graph';
import {basicNodeParser} from './node-parsers';
import {basicEdgeParser} from './edge-parsers';
import {error} from '../utils/log';
import type {LegacyGraph} from '../graph/legacy-graph';

export type JSONLegacyGraphLoaderOptions = {
  json: {
    name?: string;
    nodes?: unknown[] | null;
    edges?: unknown[] | null;
  };
  nodeParser?: typeof basicNodeParser;
  edgeParser?: typeof basicEdgeParser;
};

export function JSONLegacyGraphLoader({
  json,
  nodeParser = basicNodeParser,
  edgeParser = basicEdgeParser
}: JSONLegacyGraphLoaderOptions): LegacyGraph | null {
  const {name = 'default', nodes, edges = []} = json ?? {};
  if (!Array.isArray(nodes)) {
    error('Invalid graph: nodes is missing.');
    return null;
  }

  return createGraph({name, nodes, edges, nodeParser, edgeParser});
}
