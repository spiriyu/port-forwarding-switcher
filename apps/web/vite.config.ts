import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/ui/',
  root: resolve(__dirname, 'src'),
  build: {
    outDir: resolve(__dirname, '../../dist/apps/web'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@portswitch/shared': resolve(__dirname, '../../libs/shared/src/index.ts'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:65432',
        changeOrigin: false,
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environmentMatchGlobs: [['src/**/*.{test,spec}.tsx', 'jsdom']],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
    },
  },
});
