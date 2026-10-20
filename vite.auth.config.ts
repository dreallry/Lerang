import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist-auth', rollupOptions: { input: 'auth-actions.html' } },
});
