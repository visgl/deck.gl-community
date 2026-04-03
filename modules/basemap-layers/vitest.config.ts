/* eslint-disable import/no-extraneous-dependencies */
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['modules/basemap-layers/tests/**/*.{test,spec}.{js,ts}']
  }
});
