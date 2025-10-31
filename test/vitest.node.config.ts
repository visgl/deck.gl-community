// vitest.node.config.ts
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    name: 'node',
    environment: 'node',
    include: ['modules/**/*.unit.{test,spec}.{js,ts}'],
    // browser mode disabled
    browser: {
      enabled: false
    }
  }
});
