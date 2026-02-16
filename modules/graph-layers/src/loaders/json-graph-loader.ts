// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {LoaderOptions, LoaderWithParser} from '@loaders.gl/loader-utils';

import type {PlainGraphData} from '../graph-data/graph-data';
// import {PlainGraphDataBuilder} from '../graph-data/plain-graph-data-builder';

// __VERSION__ is injected by babel-plugin-version-inline
// @ts-ignore TS2304: Cannot find name '__VERSION__'.
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'latest';

export type JSONGraphLoaderOptions = LoaderOptions & {
  jsongraph?: {};
};

export type JSONGraphParserOptions = NonNullable<JSONGraphLoaderOptions['jsongraph']>;

export const JSONGraphLoader = {
  dataType: null as unknown as PlainGraphData,
  batchType: null as never,

  name: 'DOT Graph',
  id: 'dot-graph',
  module: 'graph-layers',
  version: VERSION,
  worker: false,
  extensions: ['json'],
  mimeTypes: ['application/json'],
  text: true,
  options: {
    jsongraph: {}
  },

  parse: async (arrayBuffer: ArrayBuffer, options?: JSONGraphLoaderOptions) => {
    const text = new TextDecoder().decode(arrayBuffer);
    return Promise.resolve(JSONGraphLoader.parseTextSync(text, options));
  },

  parseTextSync: (text: string, options?: JSONGraphLoaderOptions) => {
    // const parseOptions = {...JSONGraphLoader.options.jsongraph, ...options?.jsongraph};
    throw new Error('JSONGraphLoader.parseTextSync not implemented');
    // return loadSimpleJSONGraph(text, parseOptions);
  }
} as const satisfies LoaderWithParser<PlainGraphData, never, JSONGraphLoaderOptions>;
