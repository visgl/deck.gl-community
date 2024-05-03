// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {log} from '../utils/log';

export function basicNodeParser(node) {
  if (node.id === undefined) {
    log.error('Invalid node: id is missing.')();
    return null;
  }
  return {id: node.id};
}
