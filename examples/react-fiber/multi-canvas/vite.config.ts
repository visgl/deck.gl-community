import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@deck.gl-community/react-fiber': fileURLToPath(
        new URL('../../../modules/react-fiber/src/dom/index.ts', import.meta.url)
      ),
      '@deck.gl-community/basemap-layers': fileURLToPath(
        new URL('../../../modules/basemap-layers/src/index.ts', import.meta.url)
      )
    },
    dedupe: [
      'react',
      'react-dom',
      '@deck.gl/core',
      '@deck.gl/layers',
      '@deck.gl/geo-layers',
      '@luma.gl/core',
      '@luma.gl/engine'
    ]
  }
});
