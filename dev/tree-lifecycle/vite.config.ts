// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPOSITORY = resolve(HERE, '../..');

/** Run the playground and benchmark against the local TreeLayer source. */
export default defineConfig({
  root: HERE,
  server: {
    host: '127.0.0.1',
    port: 4393,
    strictPort: false,
    // Keep shader recompiles from interrupting a benchmark capture.
    hmr: false,
    fs: {allow: [REPOSITORY]}
  },
  resolve: {
    alias: [
      {
        find: /^@deck\.gl-community\/layers$/,
        replacement: resolve(REPOSITORY, 'modules/layers/src/index.ts')
      }
    ],
    dedupe: ['@luma.gl/core', '@luma.gl/engine', '@luma.gl/webgl', '@luma.gl/shadertools', 'preact']
  },
  optimizeDeps: {
    // Prebundle the layer and control dependencies before the first measured draw.
    include: [
      '@deck.gl/core',
      '@deck.gl/extensions',
      '@deck.gl/geo-layers',
      '@deck.gl/layers',
      '@deck.gl/mesh-layers',
      '@deck.gl/widgets',
      '@luma.gl/core',
      '@luma.gl/engine',
      '@luma.gl/shadertools',
      '@luma.gl/webgl',
      '@luma.gl/webgpu',
      '@math.gl/core',
      '@turf/helpers',
      'preact',
      'preact/compat',
      'preact/hooks',
      'preact/jsx-runtime',
      'supercluster'
    ],
    // The playground does not use the text editor panel.
    exclude: ['monaco-editor']
  },
  build: {target: 'esnext'}
});
