import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@spiriyu/shared': new URL('../../libs/shared/src/index.ts', import.meta.url).pathname,
      '@spiriyu/proxy-core': new URL('../../libs/proxy-core/src/index.ts', import.meta.url).pathname,
      '@spiriyu/service-mgr': new URL('../../libs/service-mgr/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
    },
  },
});
