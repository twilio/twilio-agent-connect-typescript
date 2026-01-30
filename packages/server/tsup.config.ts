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
    // Keep workspace dependencies and major deps as external
    '@twilio/tac-core',
    '@twilio/tac-tools',
    'fastify',
    '@fastify/websocket',
    '@fastify/cors',
    'twilio',
  ],
});