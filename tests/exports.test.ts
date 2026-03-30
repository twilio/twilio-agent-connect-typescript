import { describe, it, expect } from 'vitest';
import * as tac from '../src/index';

describe('package exports', () => {
  it('exports core classes', () => {
    expect(tac.TAC).toBeDefined();
    expect(tac.TACConfig).toBeDefined();
    expect(tac.TACMemoryResponse).toBeDefined();
  });

  it('exports channel classes', () => {
    expect(tac.VoiceChannel).toBeDefined();
    expect(tac.SMSChannel).toBeDefined();
    expect(tac.ChatChannel).toBeDefined();
    expect(tac.MessagingChannel).toBeDefined();
    expect(tac.BaseChannel).toBeDefined();
  });

  it('exports client classes', () => {
    expect(tac.MemoryClient).toBeDefined();
    expect(tac.ConversationClient).toBeDefined();
    expect(tac.KnowledgeClient).toBeDefined();
  });

  it('exports tool classes and helpers', () => {
    expect(tac.TACTool).toBeDefined();
    expect(tac.defineTool).toBeDefined();
    expect(tac.createMemoryRetrievalTool).toBeDefined();
    expect(tac.createSendMessageTool).toBeDefined();
    expect(tac.createHandoffTool).toBeDefined();
    expect(tac.createKnowledgeSearchTool).toBeDefined();
  });

  it('exports server class', () => {
    expect(tac.TACServer).toBeDefined();
  });
});
