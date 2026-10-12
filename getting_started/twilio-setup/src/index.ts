/**
 * TAC Quickstart Setup
 *
 * A local web UI that creates the Conversation Memory store and Conversation
 * Orchestrator configuration a Twilio Agent Connect app needs, then hands back the IDs
 * for your `.env`.
 *
 * Usage:
 *     npm run setup
 *     Then open http://localhost:8080 in your browser.
 */

import { buildApp } from './app';

const port = Number(process.env.TAC_SETUP_PORT ?? 8080);
// Loopback only by default: the page takes account credentials over plain HTTP. Set
// TAC_SETUP_HOST=0.0.0.0 to reach it from outside a container or VM.
const host = process.env.TAC_SETUP_HOST ?? '127.0.0.1';

const app = buildApp();

console.log('Starting TAC Quickstart Setup Server...');
console.log(`Open http://localhost:${port} in your browser`);

await app.listen({ port, host });
