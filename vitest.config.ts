import {defineConfig} from 'vitest/config';
import {playwright} from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';

const CONFIG = defineConfig({
  resolve: {
    alias: {
      crypto: 'node:crypto', // ⬅️ ensure Vite/Vitest get Node's crypto
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
            'modules/widgets/src/panel-widgets/toolbar-widget.test.ts',
            'modules/basemap-props/**'
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
