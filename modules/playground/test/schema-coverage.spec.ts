// deck.gl-community
// SPDX-License-Identifier: MIT
import {resolve} from 'node:path';
import ts from 'typescript';
import {test, expect} from 'vitest';
import {
  DeckGLLayerSchemas,
  DeckGLViewSchemas,
  DeckGLViewStateSchemas,
  ControllerOptionsSchema
} from '../src/schemas/deckgl';

test('schema inference assertions compile with strict TypeScript', () => {
  const program = ts.createProgram([resolve('modules/playground/test/schema-validation.spec.ts')], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler
  });
  const errors = ts
    .getPreEmitDiagnostics(program)
    .filter(diagnostic => !diagnostic.file || diagnostic.file.fileName.includes('/playground/'));
  expect(
    ts.formatDiagnostics(errors, {
      getCanonicalFileName: path => path,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n'
    })
  ).toBe('');
}, 30000);

test('covers upstream layer props, view props and view-state props including inheritance', () => {
  const packages = ['layers', 'aggregation-layers', 'geo-layers', 'mesh-layers', 'core'];
  const roots = packages.map(name => resolve(`node_modules/@deck.gl/${name}/src/index.ts`));
  roots.push(resolve('node_modules/@deck.gl/core/src/controllers/controller.ts'));
  const program = ts.createProgram(roots, {
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext
  });
  const checker = program.getTypeChecker();
  const exports = roots.flatMap(root =>
    checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(root)!)!)
  );
  function propNames(name: string) {
    const symbol = exports.find(s => s.name === name);
    expect(symbol, `Upstream export ${name}`).toBeDefined();
    const resolved =
      symbol!.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol!) : symbol!;
    return checker
      .getPropertiesOfType(checker.getDeclaredTypeOfSymbol(resolved))
      .map(s => s.name)
      .sort();
  }
  for (const [name, schema] of Object.entries(DeckGLLayerSchemas)) {
    const upstream = propNames(`${name}Props`).filter(
      p => !(name === 'BitmapLayer' && p === 'data')
    );
    expect(
      Object.keys(schema.shape)
        .filter(p => p !== '@@type')
        .sort(),
      name
    ).toEqual(upstream);
  }
  for (const [name, schema] of Object.entries(DeckGLViewSchemas)) {
    expect(
      Object.keys(schema.shape)
        .filter(p => p !== '@@type')
        .sort(),
      name
    ).toEqual(propNames(`${name}Props`));
    expect(
      Object.keys(DeckGLViewStateSchemas[name as keyof typeof DeckGLViewStateSchemas].shape).sort(),
      `${name} state`
    ).toEqual(propNames(`${name}State`));
  }
  expect(
    Object.keys(ControllerOptionsSchema.shape)
      .filter(p => p !== 'type')
      .sort()
  ).toEqual(propNames('ControllerOptions'));
  const concrete = exports.filter(
    s =>
      /Layer$/.test(s.name) &&
      !['_AggregationLayer', '_GeoCellLayer', 'Layer', 'CompositeLayer'].includes(s.name)
  );
  expect(
    Object.values(DeckGLLayerSchemas)
      .map(s => s.shape['@@type'].value)
      .sort()
  ).toEqual(concrete.map(s => s.name).sort());
}, 30000);
