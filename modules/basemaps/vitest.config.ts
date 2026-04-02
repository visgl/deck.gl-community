import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@deck.gl-community/basemaps/style-spec': fileURLToPath(
        new URL('./src/style-spec.js', import.meta.url)
      ),
      '@deck.gl-community/basemaps': fileURLToPath(new URL('./src/index.js', import.meta.url))
    }
  },
  test: {
    include: ['modules/basemaps/tests/**/*.{test,spec}.{js,ts}']
  }
});
