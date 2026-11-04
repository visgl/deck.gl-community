import {describe, expect, it} from 'vitest';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const options = {
  bundle: true,
  splitting: true,
  format: 'esm' as const,
  platform: 'browser' as const,
  write: false,
  outdir: '/tmp/panels-bundle-test',
  metafile: true,
  external: ['monaco-editor', 'monaco-editor/*'],
  logLevel: 'silent' as const,
  jsx: 'automatic' as const,
  jsxImportSource: 'preact'
};

describe('panels ESM loading boundary', () => {
  it('bundles an ordinary panel without retaining Monaco or its runtime bridge', async () => {
    const result = await build({
      ...options,
      stdin: {
        contents: `import {MarkdownPanel} from ${JSON.stringify(entry)}; globalThis.panel = new MarkdownPanel({id:'summary',title:'Summary',markdown:'Hello'});`,
        resolveDir: fileURLToPath(new URL('../../..', import.meta.url)),
        sourcefile: 'ordinary-panel.ts',
        loader: 'ts'
      }
    });
    const outputs = result.metafile!.outputs;
    const entryOutput = Object.entries(outputs).find(([, output]) =>
      output.entryPoint?.includes('ordinary-panel.ts')
    )!;
    expect(entryOutput).toBeDefined();
    const visited = new Set<string>();
    function visit(key: string) {
      if (visited.has(key)) return;
      visited.add(key);
      expect(outputs[key]?.entryPoint ?? '').not.toContain('monaco');
      for (const item of outputs[key]?.imports ?? []) {
        if (item.kind !== 'dynamic-import') {
          expect(item.path).not.toContain('monaco');
          visit(item.path);
        }
      }
    }
    visit(entryOutput[0]);
  });

  it('retains a dynamic runtime chunk and dynamic Monaco imports for the full public entry', async () => {
    const result = await build({...options, entryPoints: [entry]});
    const outputs = result.metafile!.outputs;
    const runtime = Object.entries(outputs).find(([, output]) =>
      output.entryPoint?.endsWith('text-editor-panel-monaco-runtime.js')
    )!;
    expect(runtime).toBeDefined();
    expect(
      runtime[1].imports
        .filter(item => item.path.startsWith('monaco-editor'))
        .map(item => item.kind)
    ).toEqual(['dynamic-import', 'dynamic-import']);
    const entryOutput = Object.entries(outputs).find(
      ([, output]) =>
        output.entryPoint === entry || output.entryPoint?.endsWith('modules/panels/dist/index.js')
    )!;
    const visited = new Set<string>();
    function visit(key: string) {
      if (visited.has(key)) return;
      visited.add(key);
      for (const item of outputs[key]?.imports ?? []) {
        if (item.kind !== 'dynamic-import') {
          expect(item.path).not.toContain('monaco');
          visit(item.path);
        }
      }
    }
    visit(entryOutput[0]);
    expect(visited.has(runtime[0])).toBe(false);
  });
});
