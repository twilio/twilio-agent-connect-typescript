/**
 * LLM Service for TAC Exec Connect Demo
 *
 * This module provides an LLM service that processes messages with context from TAC memory.
 * It builds enhanced system prompts with customer profile information and conversation history.
 * Uses OpenAI Agents SDK for tool integration and conversation management.
 */

import { Agent, run, setDefaultOpenAIKey, setTracingDisabled } from '@openai/agents';
import type { TAC, ConversationSession, TACMemoryResponse } from '@twilio/tac-core';
import type { WebSocket } from 'ws';
import {
  getAvailablePlans,
  lookUpOrderPrice,
  lookUpDiscounts,
  lookUpOutage,
  runDiagnostic,
  createConfirmOrderTool,
  createFlexEscalationTool,
} from './tools';

/**
 * OpenAI ChatCompletion message type (simplified)
 */
interface ChatCompletionMessageParam {
  role: 'user' | 'assistant';
  content: string;
}

export class LLMService {
  private readonly baseTools;

  constructor(private readonly tac: TAC) {
    // Configure OpenAI API key for Agents SDK
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (openaiApiKey) {
      setDefaultOpenAIKey(openaiApiKey);
    }

    // Disable tracing to avoid ZDR (zero data retention) errors
    setTracingDisabled(true);

    // Base tools that don't need context injection
    this.baseTools = [
      getAvailablePlans,
      lookUpOrderPrice,
      lookUpDiscounts,
      lookUpOutage,
      runDiagnostic,
    ];
  }

  /**
   * Process user message with memory context and generate response using Agents SDK.
   */
  async processMessage(
    userMessage: string,
    memoryResponse: TACMemoryResponse | null,
    context: ConversationSession,
    websocket: WebSocket | null,
    conversationHistory: ChatCompletionMessageParam[] | null = null
  ): Promise<string> {
    try {
      // Build TAC-enhanced instructions with profile context
      const enhancedInstructions = this._buildEnhancedInstructions(memoryResponse, context);

      // Create context-aware tools dynamically
      const tools = [...this.baseTools, createConfirmOrderTool(this.tac, context)];

      if (websocket !== null) {
        tools.push(createFlexEscalationTool(context));
      }

      // Create agent with TAC-enhanced instructions
      const agent = new Agent({
        name: 'Owl Internet Customer Service',
        instructions: enhancedInstructions,
        model: 'gpt-4o',
        tools,
      });

      // Use passed conversation history if provided, otherwise build from TAC session memories
      const messagesHistory = conversationHistory || this._buildConversationHistory(memoryResponse);

      // Format conversation history for agent context
      // Exclude the current user message to avoid duplication (it's at the end of the history)
      const previousMessages = messagesHistory.slice(0, -1);

      let agentInput: string;
      if (previousMessages.length > 0) {
        // Format previous messages as context
        const historyLines = previousMessages.map(msg => `${msg.role}: ${msg.content}`);
        const historyContext = historyLines.join('\n');
        agentInput = `[Previous conversation]\n${historyContext}\n\n[Current message]\n${userMessage}`;
      } else {
        // No previous history, just use the current message
        agentInput = userMessage;
      }

      // Run the agent with the message (tools are executed automatically)
      const result = await run(agent, agentInput);

      // Extract response
      return String(result.finalOutput);
    } catch (error) {
      console.error('[LLM] Error processing message:', error);
      return "I'm sorry, I'm having trouble processing your message right now. Please try again.";
    }
  }

  /**
   * Build enhanced agent instructions with TAC memory context.
   */
  private _buildEnhancedInstructions(
    memoryResponse: TACMemoryResponse | null,
    context: ConversationSession
  ): string {
    // Build instructions parts
    const instructionParts = [
      "You are Owl Internet's comprehensive customer service assistant.",
      "Your goal is to provide personalized, helpful support using the customer's " +
        'interaction history and context.',
      '',
      '=== CUSTOMER PROFILE ===',
      `- Profile ID: ${context.profile_id || 'N/A'}`,
    ];

    // Add profile traits if available
    if (context.profile?.traits) {
      // Helper to recursively find a field in nested objects
      const findField = (obj: Record<string, unknown>, fieldNames: string[]): string | null => {
        for (const [key, value] of Object.entries(obj)) {
          // Check if this key matches any of the field names (case-insensitive)
          if (
            fieldNames.some(f => f.toLowerCase() === key.toLowerCase()) &&
            typeof value === 'string'
          ) {
            return value;
          }
          // Recursively search nested objects
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            const found = findField(value as Record<string, unknown>, fieldNames);
            if (found) return found;
          }
        }
        return null;
      };

      // Helper to flatten nested traits for display
      const flattenTraits = (obj: Record<string, unknown>, prefix = ''): string[] => {
        const lines: string[] = [];
        for (const [key, value] of Object.entries(obj)) {
          const fullKey = prefix ? `${prefix}.${key}` : key;
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            lines.push(...flattenTraits(value as Record<string, unknown>, fullKey));
          } else if (value !== null && value !== undefined) {
            lines.push(`- ${fullKey}: ${String(value)}`);
          }
        }
        return lines;
      };

      // Check for customer name in nested trait groups
      const customerName = findField(context.profile.traits, ['name', 'firstName', 'first_name']);

      if (customerName) {
        instructionParts.push('');
        instructionParts.push(
          `IMPORTANT: The customer's name is ${customerName}. ` +
            'Address them by name to personalize the conversation.'
        );
      }

      // Add all traits (flattened for readability)
      instructionParts.push('');
      instructionParts.push(...flattenTraits(context.profile.traits));
      instructionParts.push('');
    }

    // Add relevant context from observations
    if (memoryResponse?.observations && memoryResponse.observations.length > 0) {
      instructionParts.push('=== RELEVANT OBSERVATIONS (from TAC Memory) ===');
      for (const obs of memoryResponse.observations) {
        instructionParts.push(`- ${obs.content}`);
      }
      instructionParts.push('');
    }

    // Add conversation summaries
    if (memoryResponse?.summaries && memoryResponse.summaries.length > 0) {
      instructionParts.push('=== CONVERSATION SUMMARIES ===');
      for (const summary of memoryResponse.summaries) {
        instructionParts.push(`- ${summary.content}`);
      }
      instructionParts.push('');
    }

    // Add TAC-enhanced behavioral instructions
    instructionParts.push(
      '=== BEHAVIOR GUIDELINES ===',
      '1. CONTEXT AWARENESS:',
      '   - Use the conversation history to maintain continuity',
      '   - Reference previous observations to show you remember past interactions',
      '   - Use summaries to understand the broader context',
      '',
      '2. COMMUNICATION STYLE:',
      '   - Keep responses clear, concise, and professional',
      '   - Show empathy and understanding of their situation',
      '   - Be helpful and proactive',
      '',
      '3. SERVICE EXCELLENCE:',
      '   - Provide helpful suggestions when appropriate',
      '   - If you need more information to help, ask specific clarifying questions',
      '   - Use the tools available to you to assist the customer',
      ''
    );

    // Add channel-specific formatting instructions
    if (context.channel === 'voice') {
      instructionParts.push(
        '=== IMPORTANT: VOICE/PHONE FORMATTING ===',
        'This conversation is over the PHONE using text-to-speech.',
        '- Use PLAIN TEXT ONLY - no markdown formatting',
        '- Do NOT use asterisks (**bold**), hashtags (#headings), or brackets',
        "- Do NOT use numbered lists (1. 2. 3.) - say 'first, second, third' instead",
        '- Do NOT use bullet points (- or *) - speak naturally',
        '- Speak as you would in a natural phone conversation',
        ''
      );
    } else if (context.channel === 'sms') {
      instructionParts.push(
        '=== SMS FORMATTING ===',
        'This conversation is via SMS text message.',
        '- Use markdown formatting for clarity (bold, lists, etc.)',
        '- Use **bold** for emphasis on important information',
        '- Use numbered lists (1. 2. 3.) for multiple options',
        '- Keep messages concise but well-formatted',
        ''
      );
    }

    return instructionParts.join('\n');
  }

  /**
   * Build conversation history from session memories.
   *
   * Session memories contain previous conversation exchanges with structured messages.
   */
  private _buildConversationHistory(
    memoryResponse: TACMemoryResponse | null
  ): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [];

    if (!memoryResponse?.communications || memoryResponse.communications.length === 0) {
      return messages;
    }

    // Extract messages from session memories
    for (const communication of memoryResponse.communications) {
      // Determine role using author.type if available (Memory API),
      // otherwise fallback to address comparison (Maestro API)
      let isCustomer = false;
      if (communication.author.type) {
        // Memory API provides author.type
        isCustomer = communication.author.type === 'CUSTOMER';
      } else {
        // Maestro fallback: compare author address with TAC phone number
        // If author address matches TAC phone number, it's from AI (assistant)
        // Otherwise, it's from customer (user)
        isCustomer = communication.author.address !== this.tac.getConfig().twilioPhoneNumber;
      }

      if (isCustomer) {
        messages.push({
          role: 'user',
          content: communication.content.text || '',
        });
      } else {
        messages.push({
          role: 'assistant',
          content: communication.content.text || '',
        });
      }
    }

    return messages;
  }
}
