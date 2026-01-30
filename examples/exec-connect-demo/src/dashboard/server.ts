/**
 * Dashboard Server
 *
 * Fastify server for serving dashboard UI and SSE events.
 * Runs on a separate port (3001) from the main TAC server.
 */

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { dashboardHandler, DashboardEvent } from './event-handler';

const DASHBOARD_PORT = 3001;

export async function startDashboardServer(): Promise<void> {
  const fastify = Fastify({
    logger: {
      level: 'warn',
    },
  });

  // Serve static files (dashboard.html, dashboard.js)
  // Use process.cwd() which is the project root in both dev and prod modes
  const publicDir = path.join(process.cwd(), 'public');

  await fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: '/public/',
  });

  // Dashboard HTML page
  fastify.get('/dashboard', async (_request, reply) => {
    return reply.sendFile('dashboard.html');
  });

  // SSE endpoint for real-time events
  fastify.get('/events', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');

    // Send initial events
    const initialEvents = dashboardHandler.getEvents();
    for (const event of initialEvents) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    // Cleanup state - using object allows const while mutating properties
    const state = { cleanedUp: false, keepalive: null as NodeJS.Timeout | null };

    // Cleanup function - removes listener and clears interval
    const cleanup = (): void => {
      if (state.cleanedUp) return;
      state.cleanedUp = true;
      if (state.keepalive) clearInterval(state.keepalive);
      dashboardHandler.off('event', onEvent);
    };

    // Event listener for new events
    const onEvent = (event: DashboardEvent): void => {
      if (state.cleanedUp) return;
      try {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        cleanup(); // Remove listener immediately on write failure
      }
    };

    dashboardHandler.on('event', onEvent);

    // Keepalive interval (15 seconds)
    state.keepalive = setInterval((): void => {
      if (state.cleanedUp) return;
      try {
        reply.raw.write(': keepalive\n\n');
      } catch {
        cleanup(); // Cleanup immediately on write failure
      }
    }, 15000);

    // Cleanup on disconnect or error
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);

    // Don't end the response - keep it open for SSE
    // Using reply.hijack() to prevent Fastify from sending response
    return reply.hijack();
  });

  // Start server
  await fastify.listen({ host: '0.0.0.0', port: DASHBOARD_PORT });
  console.log(`📊 Dashboard available at http://localhost:${DASHBOARD_PORT}/dashboard`);
}
