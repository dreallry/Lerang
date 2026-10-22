import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { privateDevFiles, protectPrivateDevFiles } from './scripts/vite-private-files.mjs';

export default defineConfig({
  plugins: [protectPrivateDevFiles(), react()],
  cacheDir: 'node_modules/.vite-auth',
  server: { fs: { deny: privateDevFiles } },
  build: { outDir: 'dist-auth', rollupOptions: { input: 'auth-actions.html' } },
});
