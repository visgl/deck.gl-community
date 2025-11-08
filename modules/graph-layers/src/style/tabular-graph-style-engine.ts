// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GraphStyleEngine, type GraphStylesheet} from './graph-style-engine';

/**
 * Thin wrapper around {@link GraphStyleEngine} used when the runtime consumes
 * interface-based graph entities. This indirection keeps the API explicit while
 * reusing the same stylesheet evaluation logic.
 */
export class TabularGraphStylesheetEngine extends GraphStyleEngine {
  constructor(style: GraphStylesheet, options: {stateUpdateTrigger?: unknown} = {}) {
    super(style, options);
  }
}
