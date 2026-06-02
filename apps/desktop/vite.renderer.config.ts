import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@portswitch/shared': resolve(__dirname, '../../libs/shared/src/index.ts'),
    },
  },
  build: {
    outDir: resolve(__dirname, '../../dist/apps/desktop/renderer'),
    emptyOutDir: true,
  },
});
