// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Local vite config for the wild-forest example.
// Resolve the local TreeLayer package from source,
// so a fresh checkout can start without a package build.
import {defineConfig} from 'vite';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@deck.gl-community/three': path.resolve(__dirname, '../../../modules/three/src/index.ts')
    }
  },
  server: {
    port: 8080,
    open: true
  },
  optimizeDeps: {
    esbuildOptions: {target: 'es2022'}
  }
});
