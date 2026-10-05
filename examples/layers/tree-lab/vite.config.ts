import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  resolve: {
    alias: {
      '@deck.gl-community/layers': fileURLToPath(
        new URL('../../../modules/layers/src/index.ts', import.meta.url)
      )
    }
  },
  server: {host: '127.0.0.1', port: 5188},
  build: {
    rollupOptions: {
      input: {
        film: fileURLToPath(new URL('./film.html', import.meta.url)),
        lab: fileURLToPath(new URL('./index.html', import.meta.url)),
        native: fileURLToPath(new URL('./native.html', import.meta.url)),
        baseline: fileURLToPath(new URL('./baseline.html', import.meta.url))
      }
    }
  }
});
