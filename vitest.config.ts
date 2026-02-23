import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts', '**/*.spec.ts'],
    },
  },
  esbuild: {
    target: 'node20',
  },
  resolve: {
    alias: {
      '@twilio/tac-core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@twilio/tac-tools': path.resolve(__dirname, 'packages/tools/src/index.ts'),
      '@twilio/tac-server': path.resolve(__dirname, 'packages/server/src/index.ts'),
    },
  },
});
