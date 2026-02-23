#!/usr/bin/env node

/**
 * Multi-Channel Customer Service Demo
 *
 * This example demonstrates a full-featured customer service bot that
 * works across SMS and Voice channels, with OpenAI integration and
 * comprehensive tool usage.
 */

import { config } from 'dotenv';
import OpenAI from 'openai';
import { TAC, SMSChannel, VoiceChannel } from '@twilio/tac-core';
import { TACServer } from '@twilio/tac-server';
import {
  createMemoryTools,
  createMessagingTools,
  createHandoffTools,
  defineTool,
} from '@twilio/tac-tools';
import { TACTool } from '@twilio/tac-core';

// Load environment variables
config();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface CustomerData {
  name: string;
  accountNumber: string;
  plan: string;
  address: string;
  outages: string[];
  balance: number;
}

// Customer data simulation (in real implementation, this would be a database)
const customerDatabase = new Map<string, CustomerData>([
  [
    '+1234567890',
    {
      name: 'John Doe',
      accountNumber: 'ACC-12345',
      plan: 'Premium Internet 100Mbps',
      address: '123 Main St, City, State',
      outages: ['2024-01-15: Planned maintenance', '2024-01-10: Network upgrade'],
      balance: 79.99,
    },
  ],
  [
    '+0987654321',
    {
      name: 'Jane Smith',
      accountNumber: 'ACC-67890',
      plan: 'Basic Internet 50Mbps',
      address: '456 Oak Ave, Town, State',
      outages: [],
      balance: 49.99,
    },
  ],
]);

async function main(): Promise<void> {
  console.log('🏢 Starting Multi-Channel Customer Service Demo...');

  try {
    // Initialize TAC
    const tac = new TAC();

    // Register SMS and Voice channels
    const smsChannel = new SMSChannel(tac);
    const voiceChannel = new VoiceChannel(tac);
    tac.registerChannel(smsChannel);
    tac.registerChannel(voiceChannel);

    // Add memory tools (only if memory client and store ID are available)
    const memoryClient = tac.getMemoryClient();
    const memoryStoreId = tac.getConfig().memoryStoreId;
    const memoryTools = memoryClient && memoryStoreId ? createMemoryTools(memoryClient, memoryStoreId) : null;

    // Create custom customer service tools
    const customerLookupTool = defineTool(
      'lookup_customer_info',
      'Look up customer information including account details, service plan, and billing information',
      {
        type: 'object',
        properties: {
          phone_number: { type: 'string', description: 'Customer phone number' },
        },
        required: ['phone_number'],
      },
      ({ phone_number }: { phone_number: string }) => {
        const customer = customerDatabase.get(phone_number);
        if (!customer) {
          return { error: 'Customer not found' };
        }
        return {
          success: true,
          customer,
        };
      }
    );

    const checkOutagesTool = defineTool(
      'check_service_outages',
      'Check for current or recent service outages in the customer area',
      {
        type: 'object',
        properties: {
          phone_number: {
            type: 'string',
            description: 'Customer phone number to check outages for',
          },
        },
        required: ['phone_number'],
      },
      ({ phone_number }: { phone_number: string }) => {
        const customer = customerDatabase.get(phone_number);
        if (!customer) {
          return { error: 'Customer not found' };
        }

        // Simulate current outages check
        const hasCurrentOutage = Math.random() < 0.1; // 10% chance of outage

        return {
          current_outages: hasCurrentOutage ? ['Network maintenance in your area'] : [],
          recent_outages: customer.outages,
          estimated_resolution: hasCurrentOutage ? '2 hours' : null,
        };
      }
    );

    const scheduleTechnicianTool = defineTool(
      'schedule_technician',
      'Schedule a technician visit for service issues',
      {
        type: 'object',
        properties: {
          phone_number: { type: 'string', description: 'Customer phone number' },
          issue_description: { type: 'string', description: 'Description of the technical issue' },
          preferred_time: { type: 'string', description: 'Preferred appointment time (optional)' },
        },
        required: ['phone_number', 'issue_description'],
      },
      ({
        phone_number,
        issue_description,
        preferred_time,
      }: {
        phone_number: string;
        issue_description: string;
        preferred_time?: string;
      }) => {
        const customer = customerDatabase.get(phone_number);
        if (!customer) {
          return { error: 'Customer not found' };
        }

        // Simulate scheduling
        const appointmentId = `TECH-${Date.now()}`;
        const scheduledTime = preferred_time || 'Tomorrow 9AM-12PM';

        return {
          success: true,
          appointment_id: appointmentId,
          scheduled_time: scheduledTime,
          technician: 'Mike Johnson',
          customer_name: customer.name,
          issue: issue_description,
        };
      }
    );

    // Create tools array
    const customerServiceTools: TACTool[] = [
      customerLookupTool,
      checkOutagesTool,
      scheduleTechnicianTool,
    ];

    interface ConversationMessage {
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string | null;
      tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
    }

    // Create conversation history storage (in-memory for demo)
    const conversationHistory = new Map<string, ConversationMessage[]>();

    // Register callback for incoming messages
    tac.onMessageReady(
      async ({
        conversationId,
        profileId,
        message,
        author,
        memory,
        session: _session,
        channel,
      }) => {
        console.log(`📱 [${channel.toUpperCase()}] Message from ${author}: ${message}`);

        // Get the channel to send responses
        const activeChannel = tac.getChannel(channel);

        try {
          // Get or create conversation history
          const history = conversationHistory.get(conversationId) || [];

          // Add user message to history
          history.push({
            role: 'user',
            content: message,
          });

          // Prepare context for OpenAI
          const systemPrompt = `You are a helpful customer service agent for TechCorp Internet Services. You have access to tools to:

1. Look up customer information (lookup_customer_info)
2. Check service outages (check_service_outages)
3. Schedule technician visits (schedule_technician)
4. Retrieve customer memory/history (retrieve_profile_memory)
5. Escalate to human agents when needed

Key guidelines:
- Always be friendly and professional
- Use tools to get accurate information
- If you can't help, offer to connect them with a human agent
- Remember previous interactions using the memory system

Customer communication channel: ${channel.toUpperCase()}
${
  memory?.observations.length
    ? `Previous interactions: ${memory.observations
        .slice(0, 3)
        .map(o => o.content)
        .join('; ')}`
    : ''
}`;

          const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt },
            ...(history.slice(-10) as OpenAI.Chat.Completions.ChatCompletionMessageParam[]), // Keep last 10 messages for context
          ];

          // Get available tools for this conversation
          const messagingTools = createMessagingTools();
          const handoffTools = createHandoffTools();

          const contextualTools = [
            ...customerServiceTools,
            messagingTools.forConversation(tac.getChannel(channel)!, conversationId),
            handoffTools.forConversation(tac, conversationId),
          ];

          if (profileId && memoryTools) {
            contextualTools.push(memoryTools.forSession(profileId));
          }

          // Map tools to OpenAI format
          const openaiTools = contextualTools.map(tool => ({
            type: 'function' as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          }));

          // Call OpenAI with tools
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages,
            tools: openaiTools,
            tool_choice: 'auto',
            temperature: 0.7,
          });

          const response = completion.choices[0]?.message;

          if (!response) {
            throw new Error('No response from OpenAI');
          }

          // Handle tool calls
          if (response.tool_calls) {
            const toolResults: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = [];

            for (const toolCall of response.tool_calls) {
              const tool = contextualTools.find(t => t.name === toolCall.function.name);

              if (tool) {
                try {
                  const params = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Tool implementation returns unknown type
                  const result = await tool.implementation(params);
                  toolResults.push({
                    tool_call_id: toolCall.id,
                    role: 'tool' as const,
                    content: JSON.stringify(result),
                  });
                } catch (error) {
                  toolResults.push({
                    tool_call_id: toolCall.id,
                    role: 'tool' as const,
                    content: JSON.stringify({ error: (error as Error).message }),
                  });
                }
              }
            }

            // Add tool call message and results to history
            history.push({
              role: 'assistant',
              content: response.content,
              tool_calls: response.tool_calls,
            });

            history.push(...(toolResults as ConversationMessage[]));

            // Get final response with tool results
            const finalMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
              { role: 'system', content: systemPrompt },
              ...(history.slice(-15) as OpenAI.Chat.Completions.ChatCompletionMessageParam[]),
            ];

            const finalCompletion = await openai.chat.completions.create({
              model: 'gpt-4o',
              messages: finalMessages,
              temperature: 0.7,
            });

            const finalResponse = finalCompletion.choices[0]?.message?.content;

            if (finalResponse) {
              history.push({
                role: 'assistant',
                content: finalResponse,
              });

              // Update conversation history
              conversationHistory.set(conversationId, history);

              // Send response through the channel
              console.log(`🔊 [RESPONSE] Sending: ${finalResponse}`);
              await activeChannel?.sendResponse(conversationId, finalResponse);
              return;
            }
          }

          // Regular response without tool calls
          if (response.content) {
            history.push({
              role: 'assistant',
              content: response.content,
            });

            conversationHistory.set(conversationId, history);

            // Send response through the channel
            console.log(`🔊 [RESPONSE] Sending: ${response.content}`);
            await activeChannel?.sendResponse(conversationId, response.content);
            return;
          }

          // Fallback response
          const fallback = "I apologize, but I'm having trouble processing your request right now. Let me connect you with a human agent who can help.";
          console.log(`🔊 [RESPONSE] Sending fallback: ${fallback}`);
          await activeChannel?.sendResponse(conversationId, fallback);
        } catch (error) {
          console.error('Error processing message:', error);
          const errorMsg = "I'm experiencing technical difficulties. Let me connect you with a human agent who can assist you immediately.";
          console.log(`🔊 [RESPONSE] Sending error: ${errorMsg}`);
          await activeChannel?.sendResponse(conversationId, errorMsg);
        }
      }
    );

    // Handle interrupts (voice channel)
    tac.onInterrupt(({ conversationId, reason, transcript, session: _session }) => {
      console.log(`🗣️ User interrupted on ${conversationId}: ${reason}`);
      if (transcript) {
        console.log(`Partial transcript: ${transcript}`);
      }
    });

    // Handle handoffs
    tac.onHandoff(({ conversationId, profileId: _profileId, reason, session }) => {
      console.log(`🤝 Handoff requested for ${conversationId}: ${reason}`);

      // In a real implementation, integrate with your support system
      // For demo, we'll just log it
      const customer =
        session.channel === 'sms'
          ? customerDatabase.get(session.conversation_id)
          : { name: 'Unknown Customer' };

      console.log(`Creating support ticket for ${customer?.name || 'Unknown'}`);
      console.log(`Channel: ${session.channel}`);
      console.log(`Reason: ${reason}`);
    });

    // Create and start server
    const server = new TACServer(tac, {
      development: true,
      voice: {
        port: Number(process.env.PORT) || 8000,
      },
    });

    await server.start();

    console.log('✅ Multi-Channel Customer Service Demo is running!');
    console.log('');
    console.log('📋 Available Channels:');
    console.log('• SMS: Configure webhook to http://your-domain.com/sms');
    console.log('• Voice: Configure webhook to http://your-domain.com/twiml');
    console.log('');
    console.log('🔧 Available Tools:');
    console.log('• Customer lookup by phone number');
    console.log('• Service outage checking');
    console.log('• Technician scheduling');
    console.log('• Memory retrieval');
    console.log('• Human handoff');
    console.log('');
    console.log('💬 Try these example requests:');
    console.log('• "Check my account status"');
    console.log('• "Is there an outage in my area?"');
    console.log('• "Schedule a technician visit"');
    console.log('• "I need to speak with someone"');

    // Graceful shutdown
    process.on('SIGINT', () => {
      void (async (): Promise<void> => {
        console.log('\n🛑 Shutting down...');
        await server.stop();
        process.exit(0);
      })();
    });
  } catch (error) {
    console.error('❌ Failed to start demo:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the demo
void main();
