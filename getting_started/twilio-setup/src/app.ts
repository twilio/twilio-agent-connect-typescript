/**
 * Fastify app for the TAC Quickstart Setup wizard.
 *
 * Serves the single-page wizard at `/` and the `/api/*` endpoints its frontend calls.
 * No response schemas are declared: fast-json-stringify would strip the diagnostic keys
 * (`endpoint`, `payload`, `response`, `status_code`) that the wizard's error panel reads.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { configurationRoutes } from './routes/configurations';
import { memoryStoreRoutes } from './routes/memory-stores';
import { profileRoutes } from './routes/profiles';
import { errorMessage } from './validation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = path.join(__dirname, '..', 'templates', 'index.html');

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.TWILIO_LOG_LEVEL?.toLowerCase() ?? 'info' },
  });

  app.get('/', async (_request, reply) => {
    // Read per request so editing the wizard HTML only needs a browser refresh.
    const html = await readFile(INDEX_HTML, 'utf8');
    return reply.type('text/html; charset=utf-8').send(html);
  });

  memoryStoreRoutes(app);
  profileRoutes(app);
  configurationRoutes(app);

  // The frontend branches on the envelope's `status`, never on the HTTP status code, so
  // even an unexpected throw has to answer in that shape to be reportable.
  app.setErrorHandler(async (error, _request, reply) => {
    app.log.error({ err: error }, 'Unhandled error in setup wizard');
    return reply.code(200).send({ status: 'error', message: `Error: ${errorMessage(error)}` });
  });

  return app;
}
