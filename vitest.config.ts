import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';
import {playwright} from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';

const ALIASES = [
  {find: 'crypto', replacement: 'node:crypto'}, // ensure Vite/Vitest get Node's crypto
  {
    find: '@deck.gl-community/basemap-layers/style-spec',
    replacement: fileURLToPath(
      new URL('./modules/basemap-layers/src/style-spec.ts', import.meta.url)
    )
  },
  {
    find: '@deck.gl-community/basemap-layers',
    replacement: fileURLToPath(new URL('./modules/basemap-layers/src/index.ts', import.meta.url))
  },
  {
    find: '@deck.gl-community/react',
    replacement: fileURLToPath(new URL('./modules/react/src/index.ts', import.meta.url))
  },
  {
    find: '@deck.gl-community/panels',
    replacement: fileURLToPath(new URL('./modules/panels/src/index.ts', import.meta.url))
  },
  {
    find: '@deck.gl-community/widgets',
    replacement: fileURLToPath(new URL('./modules/widgets/src/index.ts', import.meta.url))
  },
  {
    find: '@deck.gl-community/basemaps/style-spec',
    replacement: fileURLToPath(
      new URL('./modules/basemap-layers/src/style-spec.ts', import.meta.url)
    )
  },
  {
    find: '@deck.gl-community/basemaps',
    replacement: fileURLToPath(new URL('./modules/basemap-layers/src/index.ts', import.meta.url))
  },
  {
    find: /^monaco-editor$/,
    replacement: fileURLToPath(
      new URL('./node_modules/monaco-editor/esm/vs/editor/editor.main.js', import.meta.url)
    )
  }
];

const NODE_RESOLVE_CONFIG = {
  alias: ALIASES,
  conditions: ['node'] // prefer node resolution
};

const BROWSER_RESOLVE_CONFIG = {
  alias: ALIASES
};

const CONFIG = defineConfig({
  resolve: NODE_RESOLVE_CONFIG,
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['modules/*/src/**/*.{ts,tsx,js,jsx}', 'dev/*/src/**/*.{ts,tsx,js,jsx}'],
      exclude: ['modules/template/**', 'modules/*/src/**/*.d.ts', 'dev/*/src/**/*.d.ts']
    },
    projects: [
      {
        resolve: NODE_RESOLVE_CONFIG,
        test: {
          name: 'node',
          environment: 'node',
          include: ['modules/**/*.{test,spec}.{js,ts}', 'dev/**/*.{test,spec}.{js,ts}'],
          exclude: [
            'modules/**/dist/**',
            'dev/**/dist/**',
            'modules/**/*.browser.{test,spec}.{js,ts}',
            'dev/**/*.browser.{test,spec}.{js,ts}',
            'modules/widgets/src/widget-panels/toolbar-widget.test.ts',
            'modules/basemap-layers/**'
          ],
          browser: {
            enabled: false
          }
        }
      },
      {
        resolve: BROWSER_RESOLVE_CONFIG,
        plugins: [react()],
        test: {
          name: 'browser',
          environment: 'node',
          include: [
            'modules/**/*.browser.{test,spec}.{js,ts,jsx,tsx}',
            'modules/**/*.{test,spec}.{jsx,tsx}',
            'dev/**/*.browser.{test,spec}.{js,ts,jsx,tsx}',
            'dev/**/*.{test,spec}.{jsx,tsx}'
          ],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{browser: 'chromium'}]
          }
        }
      },
      {
        resolve: BROWSER_RESOLVE_CONFIG,
        plugins: [react()],
        test: {
          name: 'headless',
          environment: 'node',
          include: [
            'modules/**/*.browser.{test,spec}.{js,ts,jsx,tsx}',
            'modules/**/*.{test,spec}.{jsx,tsx}',
            'dev/**/*.browser.{test,spec}.{js,ts,jsx,tsx}',
            'dev/**/*.{test,spec}.{jsx,tsx}'
          ],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{browser: 'chromium'}]
          }
        }
      },
      {
        resolve: BROWSER_RESOLVE_CONFIG,
        plugins: [react()],
        test: {
          name: 'examples',
          environment: 'node',
          include: ['examples/**/*.{test,spec}.{js,ts,jsx,tsx}']
        }
      }
    ]
    // You can omit top-level include if everyone is scoped in their projects
  }
});

export default CONFIG;
