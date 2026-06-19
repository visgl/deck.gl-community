import {defineConfig} from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@deck.gl-community/infovis-layers',
        replacement: new URL('../infovis-layers/src/index.ts', import.meta.url).pathname
      },
      {
        find: '@deck.gl-community/layers',
        replacement: new URL('../layers/src/index.ts', import.meta.url).pathname
      },
      {
        find: '@deck.gl-community/panels',
        replacement: new URL('../panels/src/index.ts', import.meta.url).pathname
      },
      {
        find: '@deck.gl-community/timeline-layers',
        replacement: new URL('../../dev/timeline-layers/src/index.ts', import.meta.url).pathname
      },
      {
        find: '@deck.gl-community/widgets',
        replacement: new URL('../widgets/src/index.ts', import.meta.url).pathname
      },
      {
        find: /^monaco-editor$/,
        replacement: new URL(
          '../../node_modules/monaco-editor/esm/vs/editor/editor.main.js',
          import.meta.url
        ).pathname
      }
    ]
  },
  test: {
    environment: 'happy-dom'
  }
});
