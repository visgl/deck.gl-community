import {defineConfig} from 'vitest/config';
import {playwright} from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';

const CONFIG = defineConfig({
  resolve: {
    alias: {
      crypto: 'node:crypto' // ⬅️ ensure Vite/Vitest get Node's crypto
    },
    conditions: ['node'] // prefer node resolution
  },
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['modules/**/*.{test,spec}.{js,ts}'],
          exclude: [
            'modules/**/*.browser.{test,spec}.{js,ts}',
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
          include: ['modules/**/*.{test,spec}.{js,ts,jsx,tsx}'],
          exclude: [
            'modules/**/*.node.{test,spec}.{js,ts,jsx,tsx}',
            'modules/basemap-props/**'
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
          include: ['modules/**/*.{test,spec}.{js,ts,jsx,tsx}'],
          exclude: [
            'modules/**/*.node.{test,spec}.{js,ts,jsx,tsx}',
            'modules/basemap-props/**'
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
