import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';
import {playwright} from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';

const CONFIG = defineConfig({
  resolve: {
    alias: {
      crypto: 'node:crypto', // ensure Vite/Vitest get Node's crypto
      '@deck.gl-community/basemap-layers/style-spec': fileURLToPath(
        new URL('./modules/basemap-layers/src/style-spec.ts', import.meta.url)
      ),
      '@deck.gl-community/basemap-layers': fileURLToPath(
        new URL('./modules/basemap-layers/src/index.ts', import.meta.url)
      ),
      '@deck.gl-community/react': fileURLToPath(
        new URL('./modules/react/src/index.ts', import.meta.url)
      ),
      '@deck.gl-community/panels': fileURLToPath(
        new URL('./modules/panels/src/index.ts', import.meta.url)
      ),
      '@deck.gl-community/widgets': fileURLToPath(
        new URL('./modules/widgets/src/index.ts', import.meta.url)
      ),
      '@deck.gl-community/basemaps/style-spec': fileURLToPath(
        new URL('./modules/basemap-layers/src/style-spec.ts', import.meta.url)
      ),
      '@deck.gl-community/basemaps': fileURLToPath(
        new URL('./modules/basemap-layers/src/index.ts', import.meta.url)
      ),
      'monaco-editor': 'monaco-editor/esm/vs/editor/editor.main.js'
    },
    conditions: ['node'] // prefer node resolution
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['modules/*/src/**/*.{ts,tsx,js,jsx}', 'dev/*/src/**/*.{ts,tsx,js,jsx}'],
      exclude: ['modules/template/**', 'modules/*/src/**/*.d.ts', 'dev/*/src/**/*.d.ts']
    },
    projects: [
      {
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
