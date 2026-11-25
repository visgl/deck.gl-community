// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {build} from 'esbuild';
import {expect, it} from 'vitest';

it('bundles the playground root without the Vega renderer or runtime', async () => {
  const {metafile} = await build({
    stdin: {contents: "export * from '@deck.gl-community/playground'", resolveDir: process.cwd()},
    bundle: true,
    tsconfigRaw: {},
    format: 'esm',
    platform: 'browser',
    target: 'esnext',
    write: false,
    outdir: 'out',
    loader: {'.ttf': 'file'},
    metafile: true
  });
  const inputs = Object.keys(metafile.inputs);
  expect(inputs.some(path => path.includes('playground/dist/index.js'))).toBe(true);
  expect(
    inputs.filter(path =>
      /(?:^|\/)(?:vega-layers|node_modules\/vega(?:-[^/]+)?)(?:\/|$)/.test(path)
    )
  ).toEqual([]);
});
