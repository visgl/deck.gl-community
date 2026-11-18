// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../.cache/vite-tree-field', import.meta.url)),
  appType: 'mpa',
  server: {
    host: '127.0.0.1',
    hmr: false,
    fs: {allow: [fileURLToPath(new URL('../..', import.meta.url))]}
  }
});
