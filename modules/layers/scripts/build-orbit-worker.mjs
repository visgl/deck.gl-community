// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Bundle the propagation worker with satellite.js, over the file that tsc emitted.
await build({
  entryPoints: [
    fileURLToPath(
      new URL('../src/space-layers/orbit-layer/orbit-propagation-worker.ts', import.meta.url)
    )
  ],
  outfile: fileURLToPath(
    new URL('../dist/space-layers/orbit-layer/orbit-propagation-worker.js', import.meta.url)
  ),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  // satellite.js bundles its WebAssembly runtime, which imports node:* modules in Node-only branches.
  // The worker never loads that runtime, so leave those imports unresolved.
  external: ['node:*'],
  minify: true
});
