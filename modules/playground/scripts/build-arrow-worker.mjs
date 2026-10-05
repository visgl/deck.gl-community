// deck.gl-community
// SPDX-License-Identifier: MIT

import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Keep the parser in a local worker asset, outside the main playground bundle.
await build({
  entryPoints: [fileURLToPath(new URL('../src/runtime/playground-arrow-worker.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../dist/runtime/playground-arrow-worker.js', import.meta.url)),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true
});
