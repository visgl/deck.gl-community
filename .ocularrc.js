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
    externals: ['@deck.gl/*', '@loaders.gl/*', '@luma.gl/*', 'react', 'react-dom'],
    target: ['chrome110', 'firefox110', 'safari15'],
    format: 'umd',
    globals: {
      '@deck.gl/*': 'globalThis.deck',
      '@loaders.gl/*': 'globalThis.loaders',
      '@luma.gl/*': 'globalThis.luma',
      react: 'globalThis.React',
      'react-dom': 'globalThis.ReactDOM'
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
