import path from 'path';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'dist',
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  bundle: true,
  minify: false,
  splitting: false,
  esbuildOptions(options) {
    options.alias = {
      '@twilio/tac-core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@twilio/tac-tools': path.resolve(__dirname, '../../packages/tools/src/index.ts'),
      '@twilio/tac-server': path.resolve(__dirname, '../../packages/server/src/index.ts'),
    };
    options.packages = 'external';
  },
});
