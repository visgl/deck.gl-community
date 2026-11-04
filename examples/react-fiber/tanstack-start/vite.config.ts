import {tanstackStart} from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import {defineConfig} from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    tsConfigPaths({projects: ['./tsconfig.json']}),
    tanstackStart({srcDirectory: 'app'}),
    // React's Vite plugin must come after the TanStack Start plugin.
    viteReact()
  ]
});
