// eslint-disable-next-line
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    clearMocks: true,
    globals: true,
    environment: 'jsdom',
    setupFiles: 'src/reconciler/__tests__/setup.ts'
  }
});
