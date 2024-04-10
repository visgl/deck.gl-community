// This file contains webpack configuration settings that allow
// examples to be built against the source code in this repo instead
// of building against their installed version of the modules.

import {defineConfig} from 'vite';
import {getOcularConfig} from 'ocular-dev-tools';
import {join} from 'path';

const rootDir = join(__dirname, '..');

/** https://vitejs.dev/config/ */
export default defineConfig(async () => {
  const {aliases} = await getOcularConfig({root: rootDir});

  console.log(aliases);

  return {
    resolve: {
      alias: {
        ...aliases,
        // Use root dependencies
        '@deck.gl': join(rootDir, './node_modules/@deck.gl'),
        '@luma.gl': join(rootDir, './node_modules/@luma.gl'),
        '@math.gl': join(rootDir, './node_modules/@math.gl'),
        '@loaders.gl': join(rootDir, './node_modules/@loaders.gl'),
        // TODO: Example 'editor-core/editor' fails (loading two copies of react)
        // without these overrides. That's unexpected and should be fixed.
        'react': join(rootDir, './node_modules/react'),
        'react-dom': join(rootDir, './node_modules/react-dom'),
      }
    },
    define: {
      'process.env.GoogleMapsAPIKey': JSON.stringify(process.env.GoogleMapsAPIKey),
      'process.env.GoogleMapsMapId': JSON.stringify(process.env.GoogleMapsMapId),
      'process.env.MapboxAccessToken': JSON.stringify(process.env.MapboxAccessToken),
      'process.env.BingMapsAPIKey': JSON.stringify(process.env.BingMapsAPIKey)
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
