import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root = new URL('../', import.meta.url);
for (const name of ['rad-source-worker', 'static-source-worker']) await build({
  entryPoints: [fileURLToPath(new URL(`modules/layers/src/splat-layer/scene/${name}.ts`, root))],
  outfile: fileURLToPath(new URL(`modules/layers/dist/splat-layer/scene/${name}.js`, root)),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true
});
