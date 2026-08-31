import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_USE_MOCK_DATA': JSON.stringify(process.env.VITE_USE_MOCK_DATA ?? 'true'),
  },
  server: {
    allowedHosts: ['.trycloudflare.com'],
    fs: {
      allow: [resolve(projectRoot, '..')],
    },
  },
});
