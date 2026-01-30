/**
 * Dashboard Event Handler
 *
 * Captures and queues events for SSE streaming to dashboard clients.
 * Uses EventEmitter pattern for real-time event broadcasting.
 */

import { EventEmitter } from 'events';

/**
 * Event types matching Python implementation
 */
export type DashboardEventType =
  | 'user_message'
  | 'memory'
  | 'ai_processing'
  | 'ai_response'
  | 'handoff'
  | 'error'
  | 'call_started'
  | 'websocket_connected'
  | 'call_setup';

/**
 * Dashboard event structure
 */
export interface DashboardEvent {
  timestamp: string;
  event_type: DashboardEventType;
  conversation_id?: string;
  channel?: string;
  profile_id?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

const MAX_EVENTS = 100;

/**
 * Dashboard event handler for capturing and streaming events
 */
class DashboardEventHandler extends EventEmitter {
  private eventQueue: DashboardEvent[] = [];

  /**
   * Push a new event to the queue and emit for SSE subscribers
   */
  pushEvent(event: Omit<DashboardEvent, 'timestamp'>): void {
    const fullEvent: DashboardEvent = {
      timestamp: new Date().toISOString(),
      ...event,
    };

    this.eventQueue.push(fullEvent);

    // Trim queue if over max
    while (this.eventQueue.length > MAX_EVENTS) {
      this.eventQueue.shift();
    }

    // Emit for SSE subscribers
    this.emit('event', fullEvent);
  }

  /**
   * Get all pending events (for initial load)
   */
  getEvents(): DashboardEvent[] {
    return [...this.eventQueue];
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.eventQueue = [];
  }
}

// Singleton instance
export const dashboardHandler = new DashboardEventHandler();
