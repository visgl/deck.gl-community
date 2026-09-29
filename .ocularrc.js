/** @typedef {import('@vis.gl/dev-tools').OcularConfig} OcularConfig */

import {dirname, join} from 'path';
import {fileURLToPath} from 'url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const panelsModule = join(packageRoot, 'modules/panels/src');

/** @type {OcularConfig} */
const config = {
  babel: false,

  lint: {
    paths: ['modules', 'dev', 'docs', 'examples'],
    extensions: ['js', 'ts', 'jsx', 'tsx']
  },

  aliases: {
    // WORKSPACE MODULES
    '@deck.gl-community/panels': panelsModule
  },

  // Standalone UMD bundles (`dist/dist.min.js`), built by each package's `build-bundle` script
  // and published by `prepublishOnly`. See docs/scripting.md.
  bundle: {
    // Fallback only: each package passes its own `--globalName`, e.g. `deckCommunityLayers`
    globalName: 'deckCommunity',
    externals: ['h3-js', 'leaflet', '@deck.gl/core', '@luma.gl/core', '@luma.gl/engine'],
    target: ['chrome110', 'firefox110', 'safari15'],
    format: 'umd',
    // Keys are matched as regular expressions against the start of each external package name.
    // Only packages exposed by deck.gl's `dist.min.js` (and pydeck) are mapped to globals; other
    // peer dependencies, such as `@luma.gl/constants`, are bundled.
    globals: {
      'deck\\.gl$': 'globalThis.deck',
      '@deck\\.gl/': 'globalThis.deck',
      '@luma\\.gl/(core|engine)$': 'globalThis.luma',
      '@loaders\\.gl/core$': 'globalThis.loaders',
      'h3-js': 'globalThis.h3 || {}',
      leaflet: 'globalThis.L'
    }
  },

  entry: {
    bench: 'test/bench/index.js',
    'bench-browser': 'test/bench/index.html',
    size: ['test/size/graph-layers.js']
  }
};

export default config;
