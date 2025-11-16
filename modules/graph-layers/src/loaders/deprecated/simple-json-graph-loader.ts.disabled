// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {createGraph} from './create-graph';
import {error} from '../../utils/log';
import {basicNodeParser} from '../parsers/node-parsers';
import {basicEdgeParser} from '../parsers/edge-parsers';

/** @deprecated Use loadSimpleJSONGraph */
export const JSONLoader = ({json, nodeParser, edgeParser}) =>
  loadSimpleJSONGraph(json, {nodeParser, edgeParser});

/** A loader for a simple graph format  */
export function loadSimpleJSONGraph(
  json: Record<string, unknown>,
  options?: {nodeParser; edgeParser}
) {
  const {nodeParser = basicNodeParser, edgeParser = basicEdgeParser} = options;
  const {name = 'default', nodes, edges} = json;
  if (!nodes) {
    error('Invalid graph: nodes is missing.');
    return null;
  }

  const graph = createGraph({name, nodes, edges, nodeParser, edgeParser});
  return graph;
}
