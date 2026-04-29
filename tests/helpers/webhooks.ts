/**
 * Helper functions to create properly formatted webhook payloads for testing
 */

interface ConversationCreatedWebhook {
  eventType: 'CONVERSATION_CREATED';
  timestamp?: string;
  data: {
    id: string;
    accountId: string;
    status?: string;
    name?: string;
    configurationId?: string;
    createdAt?: string;
    updatedAt?: string;
  };
}

interface ParticipantAddedWebhook {
  eventType: 'PARTICIPANT_ADDED';
  timestamp?: string;
  data: {
    id: string;
    conversationId: string;
    accountId: string;
    name?: string;
    type?: 'HUMAN_AGENT' | 'CUSTOMER' | 'AI_AGENT' | 'AGENT' | 'UNKNOWN';
    profileId?: string | null;
    addresses: Array<{
      channel: string;
      address: string;
      channelId?: string | null;
    }>;
    createdAt?: string;
    updatedAt?: string;
  };
}

interface CommunicationCreatedWebhook {
  eventType: 'COMMUNICATION_CREATED';
  timestamp?: string;
  data: {
    id: string;
    conversationId: string;
    accountId: string;
    author: {
      address: string;
      channel: string;
      participantId: string;
    };
    content: {
      type: 'TEXT' | 'TRANSCRIPTION';
      text: string;
      transcription?: {
        channel?: number;
        confidence?: number;
        engine?: string;
        words?: unknown[];
      };
    };
    recipients: Array<{
      address: string;
      channel: string;
      participantId: string;
      deliveryStatus?: string;
    }>;
    channelId?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    occurredAt?: string | null;
  };
}

interface ConversationUpdatedWebhook {
  eventType: 'CONVERSATION_UPDATED';
  timestamp?: string;
  data: {
    id: string;
    accountId: string;
    status?: string;
    name?: string;
    configurationId?: string;
    createdAt?: string;
    updatedAt?: string;
  };
}

export function createConversationCreatedWebhook(
  overrides?: Partial<ConversationCreatedWebhook['data']>
): ConversationCreatedWebhook {
  return {
    eventType: 'CONVERSATION_CREATED',
    timestamp: new Date().toISOString(),
    data: {
      id: 'CHtest123456789',
      accountId: 'ACtest123456789',
      status: 'ACTIVE',
      configurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
      ...overrides,
    },
  };
}

export function createParticipantAddedWebhook(
  overrides?: Partial<ParticipantAddedWebhook['data']>
): ParticipantAddedWebhook {
  return {
    eventType: 'PARTICIPANT_ADDED',
    timestamp: new Date().toISOString(),
    data: {
      id: 'conv_participant_01test',
      conversationId: 'CHtest123456789',
      accountId: 'ACtest123456789',
      type: 'CUSTOMER',
      addresses: [
        {
          channel: 'SMS',
          address: '+15559876543',
        },
      ],
      ...overrides,
    },
  };
}

export function createCommunicationCreatedWebhook(
  overrides?: Partial<CommunicationCreatedWebhook['data']>
): CommunicationCreatedWebhook {
  const defaults = {
    id: 'conv_communication_01test',
    conversationId: 'CHtest123456789',
    accountId: 'ACtest123456789',
    author: {
      address: '+15559876543',
      channel: 'SMS',
      participantId: 'conv_participant_01test',
    },
    content: {
      type: 'TEXT' as const,
      text: 'Hello world',
    },
    recipients: [
      {
        address: '+15551234567',
        channel: 'SMS',
        participantId: 'conv_participant_02test',
      },
    ],
  };

  return {
    eventType: 'COMMUNICATION_CREATED',
    timestamp: new Date().toISOString(),
    data: {
      ...defaults,
      ...overrides,
      // Deep merge author and content if provided
      author: overrides?.author ? { ...defaults.author, ...overrides.author } : defaults.author,
      content: overrides?.content
        ? { ...defaults.content, ...overrides.content }
        : defaults.content,
      recipients: overrides?.recipients || defaults.recipients,
    },
  };
}

export function createConversationUpdatedWebhook(
  overrides?: Partial<ConversationUpdatedWebhook['data']>
): ConversationUpdatedWebhook {
  return {
    eventType: 'CONVERSATION_UPDATED',
    timestamp: new Date().toISOString(),
    data: {
      id: 'CHtest123456789',
      accountId: 'ACtest123456789',
      status: 'CLOSED',
      ...overrides,
    },
  };
}

/**
 * Create a simple SMS message webhook (common test pattern)
 */
export function createSMSMessageWebhook(text: string, conversationId = 'CHtest123456789') {
  return createCommunicationCreatedWebhook({
    conversationId,
    content: { type: 'TEXT', text },
  });
}
