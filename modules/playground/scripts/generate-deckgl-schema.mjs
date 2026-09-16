// deck.gl-community
// SPDX-License-Identifier: MIT

import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {createDeckGLJSONSchema} from '../dist/schemas/deckgl.js';

const dist = new URL('../dist/', import.meta.url);
const schema = createDeckGLJSONSchema();
// Include upstream descriptions in editor completions without importing deck.gl or TypeScript
// in runtime schemas. The checker resolves inherited props and aliases.
const root = new URL('../../../', import.meta.url);
const sources = ['core', 'layers', 'aggregation-layers', 'geo-layers', 'mesh-layers'].map(name =>
  fileURLToPath(new URL(`node_modules/@deck.gl/${name}/src/index.ts`, root))
);
const program = ts.createProgram(sources, {
  strict: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext
});
const checker = program.getTypeChecker();
const exports = sources.flatMap(source => {
  const file = program.getSourceFile(source);
  if (!file) throw new Error(`Missing upstream schema documentation source: ${source}`);
  return checker.getExportsOfModule(checker.getSymbolAtLocation(file));
});
for (const [name, definition] of Object.entries(schema.$defs)) {
  const typeName = name.replace(/^_/, '').replace(/Schema$/, 'Props');
  const symbol = exports.find(item => item.name === typeName || item.name === name);
  if (!symbol || !definition.properties) continue;
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  for (const prop of checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(target))) {
    const description = ts.displayPartsToString(prop.getDocumentationComment(checker));
    if (description && definition.properties[prop.name]) {
      definition.properties[prop.name].description = description;
    }
  }
}
await mkdir(dist, {recursive: true});
await writeFile(new URL('deckgl-schema.json', dist), `${JSON.stringify(schema, null, 2)}\n`);
