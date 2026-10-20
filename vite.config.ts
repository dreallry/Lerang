import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { firebaseConfigFromEnv } from './src/lib/firebaseConfig'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  firebaseConfigFromEnv(loadEnv(mode, process.cwd(), 'VITE_'));
  return {
  // Auxiliary Vite configs must not replace the running site's dependency cache.
  cacheDir: 'node_modules/.vite-app',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    fs: {
      deny: ['.env', '.env.*', '**/*.pem', '**/*.crt', '**/.git/**', '**/secrets/**', '**/*service-account*.json', '**/*firebase*adminsdk*.json', '**/*.sql', '**/uploads/ktp/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  }
})
