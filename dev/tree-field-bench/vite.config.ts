// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {fileURLToPath} from 'node:url';
import {dirname, extname, resolve} from 'node:path';
import {defineConfig} from 'vite';

const treeEntry =
  process.env.TREE_LAYER_ENTRY ??
  fileURLToPath(
    new URL('../../modules/layers/src/tree-layers/tree-layer/tree-layer.ts', import.meta.url)
  );
const selectionEntry =
  process.env.TREE_SELECTION_ENTRY ??
  (process.env.TREE_LAYER_ENTRY
    ? resolve(
        dirname(treeEntry),
        `../selection-pulse-extension/selection-pulse-extension${extname(treeEntry)}`
      )
    : fileURLToPath(
        new URL(
          '../../modules/layers/src/common-layers/selection-pulse-extension/selection-pulse-extension.ts',
          import.meta.url
        )
      ));

export default defineConfig({
  resolve: {
    alias: {
      '../../modules/layers/src/tree-layers/tree-layer/tree-layer': treeEntry,
      '../../modules/layers/src/common-layers/selection-pulse-extension/selection-pulse-extension':
        selectionEntry
    }
  },
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../.cache/vite-tree-field', import.meta.url)),
  appType: 'mpa',
  server: {
    host: '127.0.0.1',
    hmr: false,
    fs: {
      allow: [
        fileURLToPath(new URL('../..', import.meta.url)),
        resolve(dirname(treeEntry), '..'),
        dirname(selectionEntry)
      ]
    }
  }
});
