// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, extname, resolve} from 'node:path';
import {defineConfig} from 'vite';

const treeEntry =
  process.env.TREE_LAYER_ENTRY ??
  fileURLToPath(
    new URL('../../modules/layers/src/vegetation-layers/tree-layer/tree-layer.ts', import.meta.url)
  );
const defaultSelectionEntry = fileURLToPath(
  new URL('../../modules/layers/src/extensions/index.ts', import.meta.url)
);
const treeEntryDirectory = dirname(treeEntry);
const treeEntryExtension = extname(treeEntry);
const selectionEntry =
  process.env.TREE_SELECTION_ENTRY ??
  (process.env.TREE_LAYER_ENTRY
    ? [
        resolve(treeEntryDirectory, `../extensions/index${treeEntryExtension}`),
        resolve(treeEntryDirectory, `../../extensions/index${treeEntryExtension}`),
        resolve(
          treeEntryDirectory,
          `../selection-pulse-extension/selection-pulse-extension${treeEntryExtension}`
        )
      ].find(candidate => existsSync(candidate))
    : defaultSelectionEntry);

if (!selectionEntry) {
  throw new Error('Could not find SelectionPulseExtension. Set TREE_SELECTION_ENTRY explicitly.');
}

export default defineConfig({
  resolve: {
    alias: {
      '../../modules/layers/src/vegetation-layers/tree-layer/tree-layer': treeEntry,
      '@deck.gl-community/layers/extensions': selectionEntry
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
