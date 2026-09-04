import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  publicDir: resolve(projectRoot, '../frontend/public'),
  define: {
    'import.meta.env.VITE_APP_MODE': JSON.stringify('dashboard'),
    'import.meta.env.VITE_USE_MOCK_DATA': JSON.stringify(process.env.VITE_USE_MOCK_DATA ?? 'false'),
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: resolve(projectRoot, 'node_modules/react'),
      'react-dom': resolve(projectRoot, 'node_modules/react-dom'),
    },
  },
  server: {
    allowedHosts: ['.trycloudflare.com'],
    fs: {
      allow: [resolve(projectRoot, '..')],
    },
  },
});
