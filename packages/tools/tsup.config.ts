import { defineConfig } from 'tsup';
import path from 'path';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  outDir: 'dist',
  target: 'node20',
  platform: 'node',
  external: [],
  esbuildOptions(options) {
    options.alias = {
      '@twilio/tac-core': path.resolve(__dirname, '../core/src/index.ts'),
    };
  },
});
