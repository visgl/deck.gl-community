import {defineConfig} from 'vite';

import {createHash} from 'crypto';

export default defineConfig({
  plugins: [
    {
      name: 'clear-host-web-crypto',
      configureServer() {
        try {
          delete (globalThis as any).crypto;
        } catch {}
      }
    }
  ],
  resolve: {
    alias: {
      // make Vite itself use Node's builtin crypto in the server process
      crypto: 'node:crypto'
    },
    // ensure package exports that only expose the `import` condition (e.g. @deck.gl/widgets/stylesheet.css)
    // resolve correctly when Vite performs dependency scanning
    conditions: ['import', 'module', 'browser', 'default']
  },
  optimizeDeps: { 
    disabled: true, // <- hard off (works in Vite 5)
    noDiscovery: true, 
  }
});
