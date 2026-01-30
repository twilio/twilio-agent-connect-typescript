import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['server.ts'],
  format: ['esm'],
  outDir: 'dist',
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  bundle: true, // Bundle everything for single-file deployment
  minify: false, // Keep readable for development
  splitting: false,
});