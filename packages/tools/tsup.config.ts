import { defineConfig } from 'tsup';

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
  external: [
    // Keep @twilio/tac-core as external since it's a workspace dependency
    '@twilio/tac-core',
  ],
});