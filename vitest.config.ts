import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts', '**/*.spec.ts'],
    },
  },
  resolve: {
    alias: {
      '@twilio/tac-core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@twilio/tac-tools': path.resolve(__dirname, 'packages/tools/src/index.ts'),
      '@twilio/tac-server': path.resolve(__dirname, 'packages/server/src/index.ts'),
    },
  },
  esbuild: {
    target: 'node20',
  },
});
