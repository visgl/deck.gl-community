// Allows examples in dev/timeline-layers/examples/ to be built against
// the source code in this repo instead of installed node_modules.

import {defineConfig} from 'vite';
import {getOcularConfig} from '@vis.gl/dev-tools';
import {join} from 'path';

const rootDir = join(__dirname, '../..');

/** https://vitejs.dev/config/ */
export default defineConfig(async () => {
  const {aliases} = await getOcularConfig({root: rootDir});

  return {
    resolve: {
      alias: {
        ...aliases,
        '@deck.gl-community/timeline-layers': join(rootDir, './dev/timeline-layers/src'),
        'react': join(rootDir, './node_modules/react'),
        'react-dom': join(rootDir, './node_modules/react-dom'),
      }
    },
    server: {
      open: true,
      port: 8080
    },
    optimizeDeps: {
      esbuildOptions: {target: 'es2020'}
    }
  };
});
