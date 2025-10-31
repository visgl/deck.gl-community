import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

import {createHash} from 'crypto';

if (typeof globalThis.crypto.hash !== 'function') {
  const cryptoPolyfill = {
    ...globalThis.crypto,
    hash: (alg) => createHash(alg)
  };

  Object.defineProperty(globalThis, 'crypto', {
    value: cryptoPolyfill,
    writable: true, // Allows the property to be overwritten
    configurable: true // Allows the property to be redefined or deleted
  });
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // make Vite itself use Node's builtin crypto in the server process
      crypto: 'node:crypto'
    }
  },
  // completely skip the deps optimizer (this is where your stack blows up)
  optimizeDeps: {
    disabled: true       // <- hard off (works in Vite 5)
    // OR: noDiscovery: true  // softer off; if disabled didn't exist in your Vite, try this
  }
});