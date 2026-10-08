import {defineConfig} from 'vite';

// Consume the built public package, including its bundled module workers.
export default defineConfig({server: {host: '127.0.0.1', port: 8098}, build: {target: 'es2022'}});
