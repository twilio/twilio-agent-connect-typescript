#!/usr/bin/env node

/**
 * Simple SMS Bot Example
 *
 * This example demonstrates how to create a basic SMS bot using
 * the Twilio Agent Connect. The bot responds to messages with
 * helpful information and can access user memory.
 */

import { config } from 'dotenv';
import { TAC, SMSChannel } from '@twilio/tac-core';
import { TACServer } from '@twilio/tac-server';

// Load environment variables
config();

async function main(): Promise<void> {
  console.log('🤖 Starting Simple SMS Bot...');

  try {
    // Initialize TAC
    const tac = new TAC();

    // Register SMS channel
    const smsChannel = new SMSChannel(tac);
    tac.registerChannel(smsChannel);

    // Register callback for incoming messages
    tac.onMessageReady(
      async ({
        conversationId,
        profileId: _profileId,
        message,
        author,
        memory,
        session: _session,
        channel,
      }) => {
        console.log(`📱 [${channel}] New message from ${author}: ${message}`);

        // Get the channel to send responses
        const activeChannel = tac.getChannel(channel);

        // Simple responses based on message content
        const lowerMessage = message.toLowerCase();
        let response: string;

        if (lowerMessage.includes('hello') || lowerMessage.includes('hi')) {
          response = `Hello! I'm your SMS assistant. I can help you with information and remember our conversations.`;
        } else if (lowerMessage.includes('help')) {
          response = `Here's what I can do:
- Answer questions
- Remember our conversations
- Provide helpful information
- Connect you with a human if needed

Just send me a message and I'll do my best to help!`;
        } else if (lowerMessage.includes('memory')) {
          if (memory && memory.observations.length > 0) {
            const recentObservations = memory.observations.slice(0, 3);
            const observationsList = recentObservations.map(obs => `- ${obs.content}`).join('\n');

            response = `Here's what I remember about you:\n${observationsList}`;
          } else {
            response = `I don't have any specific memories about you yet. Keep chatting and I'll learn more about your preferences!`;
          }
        } else if (lowerMessage.includes('human') || lowerMessage.includes('agent')) {
          // Trigger handoff to human
          void tac.triggerHandoff(conversationId, 'User requested human assistance');
          response = `I'm connecting you with a human agent. Please wait a moment...`;
        } else {
          // Default response
          response = `Thanks for your message: "${message}". I'm a simple bot, but I'm learning! Try asking me about my capabilities or request to speak with a human.`;
        }

        // Send response through the channel
        await activeChannel?.sendResponse(conversationId, response);
      }
    );

    // Handle handoffs
    tac.onHandoff(({ conversationId, profileId: _profileId, reason, session: _session }) => {
      console.log(`🤝 Handoff requested for ${conversationId}: ${reason}`);
      // In a real implementation, this would integrate with your support system
    });

    // Create and start server
    const server = new TACServer(tac, {
      development: true,
      voice: {
        port: Number(process.env.PORT) || 8000,
      },
    });

    await server.start();

    console.log('✅ Simple SMS Bot is running!');
    console.log('');
    console.log('Configure your Twilio SMS webhook URL to:');
    console.log('http://your-domain.com/sms');
    console.log('');
    console.log('Example messages to try:');
    console.log('• "Hello" - Get a greeting');
    console.log('• "Help" - See available commands');
    console.log('• "Memory" - Check what the bot remembers');
    console.log('• "Human" - Request human assistance');

    // Graceful shutdown
    process.on('SIGINT', () => {
      void (async (): Promise<void> => {
        console.log('\n🛑 Shutting down...');
        await server.stop();
        process.exit(0);
      })();
    });
  } catch (error) {
    console.error('❌ Failed to start SMS bot:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the bot
void main();
