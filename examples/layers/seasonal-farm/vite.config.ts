// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Local vite config for the seasonal-farm example.
// Resolve the canonical TreeLayer, panels and widgets packages from source,
// so a fresh checkout can start without a package build.
import {defineConfig} from 'vite';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@deck.gl-community/layers': path.resolve(__dirname, '../../../modules/layers/src/index.ts'),
      '@deck.gl-community/panels': path.resolve(__dirname, '../../../modules/panels/src/index.ts'),
      '@deck.gl-community/widgets': path.resolve(__dirname, '../../../modules/widgets/src/index.ts')
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
