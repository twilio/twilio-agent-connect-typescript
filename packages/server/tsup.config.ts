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
  external: [
    'fastify',
    '@fastify/websocket',
    '@fastify/cors',
    'twilio',
  ],
  esbuildOptions(options) {
    options.alias = {
      '@twilio/tac-core': path.resolve(__dirname, '../core/src/index.ts'),
      '@twilio/tac-tools': path.resolve(__dirname, '../tools/src/index.ts'),
    };
  },
});
