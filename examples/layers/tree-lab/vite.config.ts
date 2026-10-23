import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@deck.gl-community/layers': fileURLToPath(
        new URL('../../../modules/layers/src/index.ts', import.meta.url)
      ),
      '@deck.gl-community/panels': fileURLToPath(
        new URL('../../../modules/panels/src/index.ts', import.meta.url)
      ),
      '@deck.gl-community/widgets': fileURLToPath(
        new URL('../../../modules/widgets/src/index.ts', import.meta.url)
      )
    }
  }
});
