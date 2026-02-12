/** @typedef {import('@vis.gl/dev-tools').OcularConfig} OcularConfig */

import {dirname, join} from 'path';
import {fileURLToPath} from 'url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const devModules = join(packageRoot, 'dev-modules');
const testDir = join(packageRoot, 'test');

/** @type {OcularConfig} */
const config = {
  babel: false,

  lint: {
    paths: ['modules', 'test'], // 'docs', 'examples'], module resolution errors
    extensions: ['js', 'ts', 'jsx', 'tsx']
  },

  typescript: {
    project: 'tsconfig.json'
  },

  aliases: {
    // DEV MODULES
    'dev-modules': devModules,

    // TEST
    test: testDir
  },

  coverage: {
    test: 'browser'
  },

  bundle: {
    globalName: 'deckCommunity',
    externals: ['h3-js', 'leaflet', '@deck.gl/core', '@luma.gl/core', '@luma.gl/engine'],
    target: ['chrome110', 'firefox110', 'safari15'],
    format: 'umd',
    globals: {
      '@deck.gl-community/*': 'globalThis.deckCommunity',
      'deck.gl': 'globalThis.deck',
      '@deck.gl/*': 'globalThis.deck',
      '@loaders.gl/*': 'globalThis.loaders',
      '@luma.gl/*': 'globalThis.luma',
       'h3-js': 'globalThis.h3 || {}',
       'leaflet': 'globalThis.L'
    }
  },

  entry: {
    test: 'test/node.js',
    'test-browser': 'index.html',
    bench: 'test/bench/index.js',
    'bench-browser': 'test/bench/index.html',
    size: ['test/size/graph-layers.js']
  }
};

export default config;
