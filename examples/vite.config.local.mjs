// This file contains webpack configuration settings that allow
// examples to be built against the source code in this repo instead
// of building against their installed version of the modules.

import {defineConfig} from 'vite';
import {getOcularConfig} from '@vis.gl/dev-tools';
import {join, resolve} from 'path';

const rootDir = join(__dirname, '..');
const deckSource = process.env.DECK_GL_SOURCE;
const terrainAliases = deckSource
  ? Object.fromEntries(
      ['core', 'layers', 'extensions', 'geo-layers', 'mesh-layers'].map(name => [
        `@deck.gl/${name}`, resolve(deckSource, 'modules', name, 'src/index.ts')
      ])
    )
  : {};

/** https://vitejs.dev/config/ */
export default defineConfig(async () => {
  const {aliases} = await getOcularConfig({root: rootDir});

  console.log(aliases);

  return {
    resolve: {
      alias: {
        ...aliases,
        ...terrainAliases,
        // TODO: Example 'editable-layers/editor' fails (loading two copies of react)
        // without these overrides. That's unexpected and should be fixed.
        'react': join(rootDir, './node_modules/react'),
        'react-dom': join(rootDir, './node_modules/react-dom'),
      },
      dedupe: deckSource
        ? ['@luma.gl/core', '@luma.gl/engine', '@luma.gl/webgl', '@luma.gl/webgpu', '@luma.gl/shadertools']
        : []
    },
    define: {
      'import.meta.env.DECK_GL_TERRAIN_WEBGPU': JSON.stringify(Boolean(deckSource)),
      'process.env.GoogleMapsAPIKey': JSON.stringify(process.env.GoogleMapsAPIKey),
      'process.env.GoogleMapsMapId': JSON.stringify(process.env.GoogleMapsMapId),
      'process.env.MapboxAccessToken': JSON.stringify(process.env.MapboxAccessToken),
      'process.env.BingMapsAPIKey': JSON.stringify(process.env.BingMapsAPIKey)
    },
    server: {
      ...(deckSource && {fs: {allow: [rootDir, resolve(deckSource)]}}),
      open: true,
      port: 8080
    },
    optimizeDeps: {
      esbuildOptions: {target: 'es2020'}
    }
  };
});
