// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPOSITORY = resolve(HERE, '../..');

/** The lab and the film, with `TreeLayer` from this worktree's source. */
export default defineConfig({
  root: HERE,
  server: {
    host: '127.0.0.1',
    port: 4393,
    strictPort: false,
    // Several agents edit source while captures run, and a hot reload would destroy a page mid-capture.
    hmr: false,
    fs: {allow: [REPOSITORY]}
  },
  resolve: {
    alias: [
      {
        find: /^@deck\.gl-community\/layers$/,
        replacement: resolve(REPOSITORY, 'modules/layers/src/index.ts')
      }
      // The stage's debug panel, which `?capture=1` never loads, takes `panels` and `widgets` as
      // built, so a half-made edit of their source does not stop it loading.
    ],
    dedupe: ['@luma.gl/core', '@luma.gl/engine', '@luma.gl/webgl', '@luma.gl/shadertools', 'preact']
  },
  optimizeDeps: {
    // Everything modules/layers imports at its entry point, so a first load does not reload itself,
    // and what the debug panel's built widgets and panels import.
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
    // The text editor panel's, which the debug panel never opens.
    exclude: ['monaco-editor']
  },
  build: {target: 'esnext'}
});
