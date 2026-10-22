import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { firebaseConfigFromEnv } from './src/lib/firebaseConfig'
import { privateDevFiles, protectPrivateDevFiles } from './scripts/vite-private-files.mjs'
import { apiPort } from './scripts/dev-config.mjs'
import { configureApiProxy } from './scripts/vite-api-proxy.mjs'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'PORT']);
  firebaseConfigFromEnv(env);
  const target = `http://127.0.0.1:${apiPort(env)}`;
  return {
  // Auxiliary Vite configs must not replace the running site's dependency cache.
  cacheDir: 'node_modules/.vite-app',
  plugins: [protectPrivateDevFiles(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    fs: {
      deny: privateDevFiles,
    },
    proxy: {
      '/api': {
        target,
        changeOrigin: true,
        configure: configureApiProxy,
      },
      '/uploads': {
        target,
        changeOrigin: true,
        configure: configureApiProxy,
      },
    },
  },
  }
})
