import {defineConfig} from 'vitest/config';
import {playwright} from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';

const CONFIG = defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            crypto: 'node:crypto' // ⬅️ ensure Vite/Vitest get Node's crypto
          },
        },
        test: {
          name: 'node',
          environment: 'node',
          include: ['modules/**/*.{test,spec}.{js,ts}'],
          exclude: ['modules/**/*.browser.{test,spec}.{js,ts}'],
          browser: {
            enabled: false
          }
        }
      },
      {
        plugins: [react()],
        test: {
          name: 'browser',
          environment: 'jsdom',
          include: ['modules/**/*.{test,spec}.{js,ts,jsx,tsx}'],
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
          environment: 'jsdom',
          include: ['modules/**/*.{test,spec}.{js,ts,jsx,tsx}'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{browser: 'chromium'}]
          }
        }
      }
    ]
    // You can omit top-level include if everyone is scoped in their projects
  }
});

export default CONFIG;
