import {defineConfig} from 'vite';

// satellite.js 7 re-exports WASM builds that use top-level await, so the bundles and the
// propagation worker need ES2022 modules.
export default defineConfig({
  build: {target: 'es2022'},
  optimizeDeps: {esbuildOptions: {target: 'es2022'}},
  worker: {format: 'es'}
});
