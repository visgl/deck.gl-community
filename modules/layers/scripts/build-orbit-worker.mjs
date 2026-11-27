// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Bundle the propagation worker with satellite.js, from its TypeScript source.
// The output replaces the file that tsc emitted.
const outfile = fileURLToPath(
  new URL('../dist/space-layers/orbit-layer/orbit-propagation-worker.js', import.meta.url)
);

await build({
  entryPoints: [
    fileURLToPath(
      new URL('../src/space-layers/orbit-layer/orbit-propagation-worker.ts', import.meta.url)
    )
  ],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  // satellite.js bundles its WebAssembly runtime, which imports node:* modules in Node-only branches.
  // The worker never loads that runtime, so leave those imports unresolved.
  external: ['node:*'],
  minify: true
});

// A browser cannot load node:* modules, so the worker must not reference any.
if (readFileSync(outfile, 'utf8').includes('node:')) {
  throw new Error(`${outfile} references a node: module, which a browser worker cannot load`);
}
