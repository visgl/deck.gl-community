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
    }
  },
  optimizeDeps: { 
    disabled: true, // <- hard off (works in Vite 5)
    noDiscovery: true, 
  }
});
