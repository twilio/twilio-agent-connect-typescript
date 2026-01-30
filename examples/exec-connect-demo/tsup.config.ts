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
});
