// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {expect, it} from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const IMPORT = /\b(?:import|export)\b[^'"]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g;

/** Extensions the build's append-extension transform completes, e.g. '.wgsl' -> '.wgsl.js'. */
function getAppendedExtensions(): Set<string> {
  const {config} = ts.parseConfigFileTextToJson(
    'tsconfig.json',
    readFileSync(join(ROOT, 'tsconfig.json'), 'utf8')
  );
  const plugins = config.compilerOptions.plugins.filter(plugin =>
    plugin.transform.endsWith('ts-transform-append-extension')
  );
  // Emitted code and declarations are transformed separately; both must agree.
  expect(plugins.map(plugin => Boolean(plugin.after || plugin.afterDeclarations))).toEqual([
    true,
    true
  ]);
  const [code, declarations] = plugins.map(plugin => [...plugin.extensions].sort().join());
  expect(declarations).toBe(code);
  return new Set(plugins[0].extensions.map(extension => extension.replace(/\.js$/, '')));
}

function* getSourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* getSourceFiles(path);
    else if (/\.tsx?$/.test(entry.name)) yield path;
  }
}

it('completes every dotted relative module import in published code', () => {
  const appended = getAppendedExtensions();
  const unresolved: string[] = [];
  const modules = join(ROOT, 'modules');
  for (const module of readdirSync(modules)) {
    const src = join(modules, module, 'src');
    if (!existsSync(src)) continue;
    for (const file of getSourceFiles(src)) {
      for (const [, specifier] of readFileSync(file, 'utf8').matchAll(IMPORT)) {
        const extension = extname(specifier);
        // An extensionless specifier gets '.js'; a dotted one (`./splat.wgsl` for
        // `splat.wgsl.ts`) is left as written unless its extension is configured,
        // which breaks strict ESM resolution of the published package.
        const isTsModule = ['.ts', '.tsx'].some(ts =>
          existsSync(resolve(dirname(file), specifier + ts))
        );
        if (extension && isTsModule && !appended.has(extension))
          unresolved.push(`${file.slice(ROOT.length + 1)}: ${specifier}`);
      }
    }
  }
  expect(unresolved).toEqual([]);
});
