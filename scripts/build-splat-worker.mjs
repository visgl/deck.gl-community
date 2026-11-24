// deck.gl-community
// SPDX-License-Identifier: MIT

import {readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = new URL('../', import.meta.url);
const scenePath = 'common-layers/splat-layer/scene';

// The codecs resolve WASM relative to their modules. Keep those assets with each
// worker when the bundle changes its URL and the host only serves the worker file.
const inlineCodecWasm = {
  name: 'inline-codec-wasm',
  setup(builder) {
    builder.onLoad({filter: /compress-utils[\\/]dist[\\/]algorithms[\\/].*\.js$/}, ({path}) => {
      const moduleUrl = pathToFileURL(path);
      const contents = readFileSync(path, 'utf8').replace(
        /new URL\(["']([^"']+\.wasm)["'],\s*import\.meta\.url\)/g,
        (_, asset) => {
          const wasm = readFileSync(new URL(asset, moduleUrl));
          return `new URL("data:application/wasm;base64,${wasm.toString('base64')}")`;
        }
      );
      return {contents, loader: 'js', resolveDir: dirname(path)};
    });
  }
};

for (const name of ['rad-source-worker', 'static-source-worker']) {
  await build({
    entryPoints: [fileURLToPath(new URL(`modules/layers/src/${scenePath}/${name}.ts`, root))],
    outfile: fileURLToPath(new URL(`modules/layers/dist/${scenePath}/${name}.js`, root)),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    plugins: [inlineCodecWasm]
  });
}
