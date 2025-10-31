import {defineConfig} from 'vitest/config';
import {playwright} from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';

import { createHash } from 'crypto';

if (typeof globalThis.crypto.hash !== 'function') {
  const cryptoPolyfill = {
    ...globalThis.crypto,
    hash: (alg) => createHash(alg),
  };

  Object.defineProperty(globalThis, 'crypto', {
    value: cryptoPolyfill,
    writable: true, // Allows the property to be overwritten
    configurable: true // Allows the property to be redefined or deleted
  });
}

const CONFIG = defineConfig({
  resolve: {
    alias: {
      crypto: 'node:crypto' // ⬅️ ensure Vite/Vitest get Node's crypto
    },
    conditions: ['node'] // prefer node resolution
  },
  // 👉 avoid the optimizer code path that’s calling into crypto hashing
  // (Vite 5.1+ deprecates the old flag; this is the recommended way)
  optimizeDeps: {
    noDiscovery: true
    // leave "include" undefined/empty so optimizer fully stays off
  },
  test: {
    projects: [
      {
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
          environment: 'node',
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
          environment: 'node',
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
