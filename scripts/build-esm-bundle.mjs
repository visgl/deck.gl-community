// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Builds `dist/dist.esm.min.js`, a self-contained ES module for loading a package with a plain
 * `import(url)` on a page that already runs deck.gl's scripting bundle (deck.gl `dist.min.js`
 * or the pydeck `@deck.gl/jupyter-widget` bundle), e.g. via
 * `pydeck.settings.register_library(name, url, module=True)`.
 *
 * deck.gl, luma.gl and loaders.gl packages exposed by that page are read from the
 * `deck`, `luma` and `loaders` globals instead of being bundled, so layers extend the
 * page's own deck.gl classes. All other dependencies are bundled.
 *
 * Run from a package directory: `node ../../scripts/build-esm-bundle.mjs`
 */

import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as esbuild from 'esbuild';

const OUTFILE = 'dist/dist.esm.min.js';

/** deck.gl modules re-exported by both deck.gl `dist.min.js` and the pydeck widget bundle */
const DECK_MODULES = [
  'core',
  'layers',
  'extensions',
  'aggregation-layers',
  'geo-layers',
  'mesh-layers',
  'widgets'
].map(name => `@deck.gl/${name}`);

/** Only these names are exposed, see @deck.gl/core/src/scripting/{lumagl,loadersgl}.ts */
const LUMA_MODULES = ['@luma.gl/core', '@luma.gl/engine'];
const LOADERS_MODULES = ['@loaders.gl/core'];

/** Packages that must come from the page but are not exposed as a global */
const UNAVAILABLE =
  /^(deck\.gl$|@deck\.gl\/|@luma\.gl\/(core|engine|webgl|webgpu)\/|@luma\.gl\/(webgl|webgpu)$|@loaders\.gl\/core\/)/;

const packageDir = process.cwd();
const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const require = createRequire(join(packageDir, 'package.json'));

const globals = await getGlobalExports();

const options = {
  absWorkingDir: packageDir,
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: true,
  target: ['chrome110', 'firefox110', 'safari15'],
  outfile: OUTFILE,
  metafile: true,
  logLevel: 'warning'
};

await checkGlobalImports();

const result = await esbuild.build({...options, plugins: [pageGlobalsPlugin({checkNames: false})]});

const bundledPageModules = Object.keys(result.metafile.inputs).filter(path =>
  /node_modules\/(deck\.gl|@deck\.gl|@luma\.gl\/(core|engine|webgl|webgpu)|@loaders\.gl\/core)\//.test(
    path
  )
);
if (bundledPageModules.length) {
  throw new Error(`${OUTFILE} must not bundle:\n  ${bundledPageModules.join('\n  ')}`);
}
console.log(`${pkg.name}: built ${OUTFILE}`);

/**
 * Builds once with each global exposed as a module with explicit named exports, so esbuild
 * reports every imported name the page does not provide. Missing deck.gl names fail the build.
 * Missing luma.gl / loaders.gl names are only reported: the page exposes a small subset, and
 * only the layers that use the missing names are unavailable from the bundle.
 */
async function checkGlobalImports() {
  let errors;
  try {
    await esbuild.build({
      ...options,
      write: false,
      logLevel: 'silent',
      logOverride: {'import-is-undefined': 'error'},
      plugins: [pageGlobalsPlugin({checkNames: true})]
    });
    return;
  } catch (error) {
    errors = error.errors;
  }
  const formatted = await esbuild.formatMessages(errors, {kind: 'error', color: false});
  const missingNames = errors.filter(error => /page-global:@(luma|loaders)\.gl\//.test(error.text));
  if (missingNames.length === errors.length) {
    const unavailable = missingNames.map(({text, location}) => `  ${location?.file}: ${text}`);
    console.warn(`${pkg.name}: not exposed by the page, unavailable:\n${unavailable.join('\n')}`);
    return;
  }
  throw new Error(`${pkg.name}: cannot build ${OUTFILE}\n${formatted.join('\n')}`);
}

/** esbuild plugin that resolves page-provided modules to the page's globals */
function pageGlobalsPlugin({checkNames}) {
  return {
    name: 'page-globals',
    setup(build) {
      build.onResolve({filter: /^(deck\.gl|@deck\.gl|@luma\.gl|@loaders\.gl)(\/|$)/}, args => {
        if (globals[args.path]) {
          return {path: args.path, namespace: 'page-global'};
        }
        if (UNAVAILABLE.test(args.path)) {
          return {errors: [{text: `"${args.path}" is not exposed by deck.gl's scripting bundle`}]};
        }
        // Other luma.gl and loaders.gl modules are bundled
        return undefined;
      });

      // Peer dependencies are provided by the page; fail if the page has no global for one
      build.onResolve({filter: /.*/}, args => {
        const name = args.path.match(/^(@[^/]+\/)?[^/.][^/]*/)?.[0];
        if (name && pkg.peerDependencies?.[name] && !/^@(luma|loaders)\.gl\//.test(name)) {
          return {errors: [{text: `peer dependency "${name}" is not provided by the page`}]};
        }
        return undefined;
      });

      build.onLoad({filter: /.*/, namespace: 'page-global'}, args => {
        const {globalName, names} = globals[args.path];
        return {
          contents: checkNames
            ? `export const {${names.join(', ')}} = globalThis.${globalName};`
            : `module.exports = globalThis.${globalName};`,
          loader: 'js'
        };
      });
    }
  };
}

/** Returns, per page-provided module specifier, its global and the names it exposes */
async function getGlobalExports() {
  const importExports = async path => Object.keys(await import(path));
  const deckCoreDir = pathToFileURL(join(require.resolve('@deck.gl/core'), '../..')).href;

  const lumaNames = await importExports(`${deckCoreDir}/dist/scripting/lumagl.js`);
  const loadersNames = await importExports(`${deckCoreDir}/dist/scripting/loadersgl.js`);

  const exports = {};
  for (const name of DECK_MODULES) {
    exports[name] = {globalName: 'deck', names: await importExports(name)};
  }
  for (const name of LUMA_MODULES) {
    exports[name] = {globalName: 'luma', names: lumaNames};
  }
  for (const name of LOADERS_MODULES) {
    exports[name] = {globalName: 'loaders', names: loadersNames};
  }
  return exports;
}
