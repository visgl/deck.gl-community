// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {NodeOptions} from '../graph/node';
import {log} from '../utils/log';

export function basicNodeParser(node: any): Pick<NodeOptions, 'id'> {
  if (node.id === undefined) {
    log.error('Invalid node: id is missing.')();
    return null;
  }
  return {id: node.id};
}
