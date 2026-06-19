import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

const infovisLayersSource = fileURLToPath(
  new URL('../../../modules/infovis-layers/src', import.meta.url)
);
const layersSource = fileURLToPath(new URL('../../../modules/layers/src', import.meta.url));
const timelineLayersSource = fileURLToPath(
  new URL('../../../dev/timeline-layers/src', import.meta.url)
);
const traceLayersSource = fileURLToPath(
  new URL('../../../modules/trace-layers/src', import.meta.url)
);

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@deck\.gl-community\/trace-layers\/(.+)$/,
        replacement: `${traceLayersSource}/$1`
      },
      {
        find: '@deck.gl-community/trace-layers',
        replacement: traceLayersSource
      },
      {
        find: '@deck.gl-community/infovis-layers',
        replacement: infovisLayersSource
      },
      {
        find: '@deck.gl-community/layers',
        replacement: layersSource
      },
      {
        find: '@deck.gl-community/timeline-layers',
        replacement: timelineLayersSource
      }
    ]
  }
});
