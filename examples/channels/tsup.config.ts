import { defineConfig } from 'tsup';

export default defineConfig([
  // SMS Channel Example
  {
    entry: ['sms.ts'],
    format: ['esm'],
    outDir: 'dist',
    target: 'node20',
    platform: 'node',
    sourcemap: true,
    clean: true,
    bundle: true, // Bundle everything for single-file deployment
    minify: false, // Keep readable for development
    splitting: false,
  },
  // Voice Channel Example
  {
    entry: ['voice.ts'],
    format: ['esm'],
    outDir: 'dist',
    target: 'node20',
    platform: 'node',
    sourcemap: true,
    clean: false, // Don't clean between builds
    bundle: true,
    minify: false,
    splitting: false,
  },
]);