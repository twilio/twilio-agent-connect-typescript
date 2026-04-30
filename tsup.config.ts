import { defineConfig } from 'tsup';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    'twilio',
    'fastify',
    '@fastify/websocket',
    '@fastify/formbody',
    '@fastify/cors',
    'fastify-graceful-shutdown',
    'ws',
    'pino',
    'zod',
  ],
  esbuildOptions(options) {
    options.alias = {
      '@twilio/tac-core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@twilio/tac-tools': path.resolve(__dirname, 'packages/tools/src/index.ts'),
      '@twilio/tac-server': path.resolve(__dirname, 'packages/server/src/index.ts'),
    };
  },
});
