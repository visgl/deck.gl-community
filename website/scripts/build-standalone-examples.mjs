import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';

// These applications own their document, controls, and canvas. Bundle their original
// HTML entries together so the embedded demos share dependencies and standalone behavior.
const repo = fileURLToPath(new URL('../../', import.meta.url));
const root = resolve(repo, 'examples/layers');
const examples = ['globe-clouds', 'sketch-edges', 'sky-layers', 'timeline-layer'];

export async function buildStandaloneExamples() {
  await build({
    configFile: false,
    root,
    base: './',
    publicDir: false,
    esbuild: {jsx: 'automatic'},
    resolve: {
      alias: [
        {
          find: /^@deck\.gl-community\/layers\/(.+)$/,
          replacement: resolve(repo, 'modules/layers/src/$1')
        },
        ...['panels', 'widgets'].map(name => ({
          find: `@deck.gl-community/${name}`,
          replacement: resolve(repo, 'modules', name, 'src')
        }))
      ]
    },
    build: {
      target: 'esnext',
      outDir: resolve(repo, 'website/.standalone-static/demos'),
      emptyOutDir: true,
      rollupOptions: {input: examples.map(name => resolve(root, name, 'index.html'))}
    }
  });
}
