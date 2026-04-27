import { describe, it, expect } from 'vitest';
import { MemoryPromptBuilder } from '../packages/core/src/adapters/prompt-builder';
import { buildProfilePrompt } from '../packages/core/src/lib/conversation-session-helpers';
import { TACMemoryResponse } from '../packages/core/src/lib/tac-memory-response';
import {
  ConversationSession,
  ObservationInfo,
  SummaryInfo,
  MemoryCommunication,
  MemoryRetrievalResponse,
} from '../packages/core/src/types';

describe('MemoryPromptBuilder', () => {
  const createSampleMemoryResponse = (): TACMemoryResponse => {
    const memoryData: MemoryRetrievalResponse = {
      observations: [
        {
          id: 'obs1',
          content: 'Customer prefers email communication',
          createdAt: '2024-01-01T00:00:00Z',
          occurredAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          source: 'conversation',
        } as ObservationInfo,
      ],
      summaries: [
        {
          id: 'sum1',
          content: 'Previous discussion about billing issues',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        } as SummaryInfo,
      ],
      communications: [
        {
          id: 'comm1',
          content: { text: 'Hello, I need help' },
          author: {
            id: 'part1',
            name: 'John Doe',
            address: '+1234567890',
            channel: 'SMS',
            type: 'CUSTOMER',
          },
          recipients: [],
          created_at: '2024-01-01T00:00:00Z',
        } as MemoryCommunication,
      ],
    };
    return new TACMemoryResponse(memoryData);
  };

  const createSampleContext = (): ConversationSession => {
    return {
      conversationId: 'conv123',
      profileId: 'prof456',
      channel: 'sms',
      startedAt: new Date(),
      profile: {
        profileId: 'prof456',
        traits: {
          Contact: { name: 'John Doe', email: 'john@example.com' },
          Preferences: { language: 'en', timezone: 'PST' },
        },
      },
      metadata: {},
    };
  };

  describe('build', () => {
    it('should build complete prompt with all sections', () => {
      const memory = createSampleMemoryResponse();
      const context = createSampleContext();

      const prompt = MemoryPromptBuilder.build(memory, context);

      expect(prompt).toBeTruthy();
      expect(prompt).toContain('# Customer Context');
      expect(prompt).toContain('## Customer Profile');
      expect(prompt).toContain('John Doe');
      expect(prompt).toContain('john@example.com');
      expect(prompt).toContain('## Key Observations');
      expect(prompt).toContain('Customer prefers email communication');
      expect(prompt).toContain('## Past Conversation Summaries');
      expect(prompt).toContain('Previous discussion about billing issues');
      expect(prompt).toContain('## Recent Message History');
      expect(prompt).toContain('Hello, I need help');
    });

    it('should return empty string when no memory or profile data', () => {
      const prompt = MemoryPromptBuilder.build(null, null);

      expect(prompt).toBe('');
    });

    it('should build prompt with only memory data', () => {
      const memory = createSampleMemoryResponse();

      const prompt = MemoryPromptBuilder.build(memory, null);

      expect(prompt).toBeTruthy();
      expect(prompt).toContain('Customer prefers email communication');
      expect(prompt).not.toContain('Customer Profile');
    });

    it('should build prompt with only profile data', () => {
      const context = createSampleContext();

      const prompt = MemoryPromptBuilder.build(null, context);

      expect(prompt).toBeTruthy();
      expect(prompt).toContain('## Customer Profile');
      expect(prompt).toContain('John Doe');
      expect(prompt).not.toContain('Key Observations');
    });

    it('should filter profile traits with options', () => {
      const context = createSampleContext();
      const options = { profileTraits: ['Contact'] };

      const prompt = MemoryPromptBuilder.build(null, context, options);

      expect(prompt).toBeTruthy();
      expect(prompt).toContain('Contact');
      expect(prompt).toContain('John Doe');
      expect(prompt).not.toContain('Preferences');
    });

    it('should exclude all traits with empty profileTraits array', () => {
      const context = createSampleContext();
      const options = { profileTraits: [] };

      const prompt = MemoryPromptBuilder.build(null, context, options);

      expect(prompt).toBe('');
    });
  });
});

describe('buildProfilePrompt', () => {
  it('should build profile prompt with all traits', () => {
    const context: ConversationSession = {
      conversationId: 'conv123',
      channel: 'sms',
      startedAt: new Date(),
      profile: {
        profileId: 'prof456',
        traits: {
          Contact: { name: 'John Doe', email: 'john@example.com' },
          Preferences: { language: 'en' },
        },
      },
      metadata: {},
    };

    const prompt = buildProfilePrompt(context);

    expect(prompt).toBeTruthy();
    expect(prompt).toContain('## Customer Profile');
    expect(prompt).toContain('Contact');
    expect(prompt).toContain('Preferences');
  });

  it('should filter traits by trait groups', () => {
    const context: ConversationSession = {
      conversationId: 'conv123',
      channel: 'sms',
      startedAt: new Date(),
      profile: {
        profileId: 'prof456',
        traits: {
          Contact: { name: 'John Doe' },
          Preferences: { language: 'en' },
        },
      },
      metadata: {},
    };

    const prompt = buildProfilePrompt(context, ['Contact']);

    expect(prompt).toBeTruthy();
    expect(prompt).toContain('Contact');
    expect(prompt).not.toContain('Preferences');
  });

  it('should return null for empty trait groups array', () => {
    const context: ConversationSession = {
      conversationId: 'conv123',
      channel: 'sms',
      startedAt: new Date(),
      profile: {
        profileId: 'prof456',
        traits: { Contact: { name: 'John Doe' } },
      },
      metadata: {},
    };

    const prompt = buildProfilePrompt(context, []);

    expect(prompt).toBeNull();
  });

  it('should return null when no profile', () => {
    const context: ConversationSession = {
      conversationId: 'conv123',
      channel: 'sms',
      startedAt: new Date(),
      metadata: {},
    };

    const prompt = buildProfilePrompt(context);

    expect(prompt).toBeNull();
  });

  it('should filter out null trait values', () => {
    const context: ConversationSession = {
      conversationId: 'conv123',
      channel: 'sms',
      startedAt: new Date(),
      profile: {
        profileId: 'prof456',
        traits: {
          Contact: { name: 'John Doe' },
          EmptyTrait: null,
        },
      },
      metadata: {},
    };

    const prompt = buildProfilePrompt(context);

    expect(prompt).toBeTruthy();
    expect(prompt).toContain('Contact');
    expect(prompt).not.toContain('EmptyTrait');
  });

  it('should format primitive trait values without quotes', () => {
    const context: ConversationSession = {
      conversationId: 'conv123',
      channel: 'sms',
      startedAt: new Date(),
      profile: {
        profileId: 'prof456',
        traits: {
          StringValue: 'en',
          NumberValue: 42,
          BooleanValue: true,
          ObjectValue: { name: 'John Doe', email: 'john@example.com' },
        },
      },
      metadata: {},
    };

    const prompt = buildProfilePrompt(context);

    expect(prompt).toBeTruthy();
    // Primitives should be formatted without quotes
    expect(prompt).toContain('StringValue: en');
    expect(prompt).not.toContain('StringValue: "en"');
    expect(prompt).toContain('NumberValue: 42');
    expect(prompt).toContain('BooleanValue: true');
    // Objects should be JSON stringified
    expect(prompt).toContain('ObjectValue: {"name":"John Doe","email":"john@example.com"}');
  });

  it('should handle bigint and edge case trait values safely', () => {
    const context: ConversationSession = {
      conversationId: 'conv123',
      channel: 'sms',
      startedAt: new Date(),
      profile: {
        profileId: 'prof456',
        traits: {
          BigIntValue: BigInt(9007199254740991),
          ArrayValue: ['item1', 'item2'],
        },
      },
      metadata: {},
    };

    const prompt = buildProfilePrompt(context);

    expect(prompt).toBeTruthy();
    // BigInt should be formatted without quotes
    expect(prompt).toContain('BigIntValue: 9007199254740991');
    // Arrays should be JSON stringified
    expect(prompt).toContain('ArrayValue: ["item1","item2"]');
  });

  it('should handle nested bigints in objects', () => {
    const context: ConversationSession = {
      conversationId: 'conv123',
      channel: 'sms',
      startedAt: new Date(),
      profile: {
        profileId: 'prof456',
        traits: {
          UserData: {
            userId: BigInt(9007199254740991),
            name: 'John Doe',
            timestamp: BigInt(1234567890),
          },
        },
      },
      metadata: {},
    };

    const prompt = buildProfilePrompt(context);

    expect(prompt).toBeTruthy();
    // Nested bigints should be converted to strings in JSON
    expect(prompt).toContain('UserData: {"userId":"9007199254740991"');
    expect(prompt).toContain('"name":"John Doe"');
    expect(prompt).toContain('"timestamp":"1234567890"}');
  });
});

describe('TACMemoryResponse.buildMemoryPrompts', () => {
  it('should build all memory sections', () => {
    const memoryData: MemoryRetrievalResponse = {
      observations: [
        {
          id: 'obs1',
          content: 'Customer prefers email',
          createdAt: '2024-01-01T00:00:00Z',
        } as ObservationInfo,
      ],
      summaries: [
        {
          id: 'sum1',
          content: 'Previous billing discussion',
          createdAt: '2024-01-01T00:00:00Z',
        } as SummaryInfo,
      ],
      communications: [
        {
          id: 'comm1',
          content: { text: 'Hello' },
          author: { address: '+1234567890', channel: 'SMS', type: 'CUSTOMER' },
          recipients: [],
          created_at: '2024-01-01T00:00:00Z',
        } as MemoryCommunication,
      ],
    };

    const response = new TACMemoryResponse(memoryData);
    const sections = response.buildMemoryPrompts();

    expect(sections).toHaveLength(3);
    expect(sections[0]).toContain('## Key Observations');
    expect(sections[0]).toContain('Customer prefers email');
    expect(sections[1]).toContain('## Past Conversation Summaries');
    expect(sections[1]).toContain('Previous billing discussion');
    expect(sections[2]).toContain('## Recent Message History');
    expect(sections[2]).toContain('Hello');
  });

  it('should return empty array when no memory data', () => {
    const memoryData: MemoryRetrievalResponse = {
      observations: [],
      summaries: [],
      communications: [],
    };

    const response = new TACMemoryResponse(memoryData);
    const sections = response.buildMemoryPrompts();

    expect(sections).toHaveLength(0);
  });

  it('should label customer messages as User', () => {
    const memoryData: MemoryRetrievalResponse = {
      observations: [],
      summaries: [],
      communications: [
        {
          id: 'comm1',
          content: { text: 'Customer message' },
          author: { address: '+1234567890', channel: 'SMS', type: 'CUSTOMER' },
          recipients: [],
          created_at: '2024-01-01T00:00:00Z',
        } as MemoryCommunication,
      ],
    };

    const response = new TACMemoryResponse(memoryData);
    const sections = response.buildMemoryPrompts();

    expect(sections[0]).toContain('User: Customer message');
  });

  it('should label non-customer messages as Assistant', () => {
    const memoryData: MemoryRetrievalResponse = {
      observations: [],
      summaries: [],
      communications: [
        {
          id: 'comm1',
          content: { text: 'Agent response' },
          author: { address: '+1234567890', channel: 'SMS', type: 'AI_AGENT' },
          recipients: [],
          created_at: '2024-01-01T00:00:00Z',
        } as MemoryCommunication,
      ],
    };

    const response = new TACMemoryResponse(memoryData);
    const sections = response.buildMemoryPrompts();

    expect(sections[0]).toContain('Assistant: Agent response');
  });

  it('should skip communications with missing text content', () => {
    const memoryData: MemoryRetrievalResponse = {
      observations: [],
      summaries: [],
      communications: [
        {
          id: 'comm1',
          content: {},
          author: { address: '+1234567890', channel: 'SMS', type: 'CUSTOMER' },
          recipients: [],
          created_at: '2024-01-01T00:00:00Z',
        } as MemoryCommunication,
        {
          id: 'comm2',
          content: { text: 'Valid message' },
          author: { address: '+1234567890', channel: 'SMS', type: 'CUSTOMER' },
          recipients: [],
          created_at: '2024-01-01T00:00:00Z',
        } as MemoryCommunication,
      ],
    };

    const response = new TACMemoryResponse(memoryData);
    const sections = response.buildMemoryPrompts();

    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain('Valid message');
    expect(sections[0]).not.toMatch(/User:\s*$/m);
  });

  it('should skip communications with empty text content', () => {
    const memoryData: MemoryRetrievalResponse = {
      observations: [],
      summaries: [],
      communications: [
        {
          id: 'comm1',
          content: { text: '   ' },
          author: { address: '+1234567890', channel: 'SMS', type: 'CUSTOMER' },
          recipients: [],
          created_at: '2024-01-01T00:00:00Z',
        } as MemoryCommunication,
      ],
    };

    const response = new TACMemoryResponse(memoryData);
    const sections = response.buildMemoryPrompts();

    expect(sections).toHaveLength(0);
  });

  it('should return an empty array when all communications have empty content', () => {
    const memoryData: MemoryRetrievalResponse = {
      observations: [],
      summaries: [],
      communications: [
        {
          id: 'comm1',
          content: {},
          author: { address: '+1234567890', channel: 'SMS', type: 'CUSTOMER' },
          recipients: [],
          created_at: '2024-01-01T00:00:00Z',
        } as MemoryCommunication,
        {
          id: 'comm2',
          content: { text: '' },
          author: { address: '+1234567890', channel: 'SMS', type: 'AI_AGENT' },
          recipients: [],
          created_at: '2024-01-01T00:00:00Z',
        } as MemoryCommunication,
      ],
    };

    const response = new TACMemoryResponse(memoryData);
    const sections = response.buildMemoryPrompts();

    expect(sections).toHaveLength(0);
  });
});
