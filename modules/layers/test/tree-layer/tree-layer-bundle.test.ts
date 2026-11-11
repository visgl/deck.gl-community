// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {build} from 'esbuild';
import {expect, it} from 'vitest';

// This integration branch includes the full photoreal preview. Its baseline is
// 526,226 minified bytes and 175,985 gzip bytes, up from 133,795 and 44,252.
const MINIFIED_LIMIT = 550_000;
const GZIP_LIMIT = 184_000;

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
