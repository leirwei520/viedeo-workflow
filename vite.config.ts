import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const isElectronBuild = !!env.ELECTRON;

  return {
    base: isElectronBuild ? './' : '/',
    define: {
      __APP_ENV__: JSON.stringify(env.VITE_APP_ENV || mode),
    },
    server: {
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
          timeout: 25 * 60 * 1000,
          proxyTimeout: 25 * 60 * 1000,
        },
        '/library': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true
        }
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-ui': ['framer-motion', 'lucide-react', 'clsx', 'tailwind-merge'],
            'vendor-i18n': ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
            'vendor-markdown': ['react-markdown'],
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
