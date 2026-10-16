/* eslint-disable import/no-extraneous-dependencies */
import {defineConfig} from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@deck.gl-community/geo-layers': new URL('../geo-layers/src/index.ts', import.meta.url)
        .pathname
    }
  },
  test: {
    environment: 'node',
    include: ['modules/basemap-layers/tests/**/*.{test,spec}.{js,ts}'],
    exclude: ['modules/basemap-layers/tests/**/*.browser.{test,spec}.{js,ts}']
  }
});
