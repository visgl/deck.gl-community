// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {build} from 'esbuild';
import {expect, it} from 'vitest';

// Current baseline is 133,795 minified bytes and 44,252 gzip bytes. Raise these
// limits deliberately as renderer changes land and include the measured delta in review.
const MINIFIED_LIMIT = 140_000;
const GZIP_LIMIT = 46_000;

it('keeps a TreeLayer-only app within the bundle budget', async () => {
  const root = fileURLToPath(new URL('../../../..', import.meta.url));
  const {outputFiles, metafile} = await build({
    absWorkingDir: root,
    stdin: {
      contents: "export {TreeLayer} from './modules/layers/src/index.ts';",
      resolveDir: root,
      sourcefile: 'tree-layer-app.ts',
      loader: 'ts'
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    minify: true,
    write: false,
    metafile: true,
    // Measure code added by TreeLayer in an app that already uses deck.gl.
    external: ['@deck.gl/*', '@luma.gl/*', '@math.gl/*', '@loaders.gl/*', '@probe.gl/*']
  });
  const [bundle] = outputFiles;
  const [output] = Object.values(metafile.outputs);
  const largestInputs = Object.entries(output.inputs)
    .sort(([, a], [, b]) => b.bytesInOutput - a.bytesInOutput)
    .slice(0, 5)
    .map(([file, {bytesInOutput}]) => `${file} (${bytesInOutput} bytes)`)
    .join('\n');
  const hint = `Largest inputs in the TreeLayer bundle:\n${largestInputs}`;

  expect(output.bytes, hint).toBeLessThanOrEqual(MINIFIED_LIMIT);
  expect(gzipSync(bundle.contents).length, hint).toBeLessThanOrEqual(GZIP_LIMIT);
});
