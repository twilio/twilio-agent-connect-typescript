#!/usr/bin/env node

/**
 * Knowledge Search Example
 *
 * This example demonstrates how to use the knowledge search tool
 * with Twilio Agent Connect to search a knowledge base via SMS.
 */

import { config } from 'dotenv';
import { TAC, SMSChannel } from '@twilio/tac-core';
import { TACServer } from '@twilio/tac-server';
import { createKnowledgeSearchTool } from '@twilio/tac-tools';

// Load environment variables
config();

async function main(): Promise<void> {
  console.log('🔍 Starting Knowledge Search Bot...');

  try {
    // Initialize TAC
    const tac = new TAC();

    // Get knowledge client
    const knowledgeClient = tac.getKnowledgeClient();
    if (!knowledgeClient) {
      throw new Error(
        'Knowledge client not initialized. ' +
          'Please set MEMORY_API_KEY and MEMORY_API_TOKEN environment variables.'
      );
    }

    // Get knowledge base ID from environment
    const knowledgeBaseId = process.env.KNOWLEDGE_BASE_ID;
    if (!knowledgeBaseId) {
      throw new Error('KNOWLEDGE_BASE_ID environment variable is required');
    }

    // Create knowledge search tool
    const knowledgeTool = createKnowledgeSearchTool(knowledgeClient, knowledgeBaseId, {
      name: 'search_faq',
      description: 'Search the FAQ knowledge base for answers to user questions',
    });

    // Register SMS channel
    const smsChannel = new SMSChannel(tac);
    tac.registerChannel(smsChannel);

    // Register callback for incoming messages
    tac.onMessageReady(async ({ conversationId, message, author, channel }) => {
      console.log(`📱 [${channel}] New message from ${author}: ${message}`);

      // Get the channel to send responses
      const activeChannel = tac.getChannel(channel);

      // Search knowledge base
      console.log(`🔎 Searching knowledge base for: "${message}"`);
      const results = await knowledgeTool.implementation({ query: message });

      let response: string;
      if (results.length > 0) {
        // Format results
        const topResults = results.slice(0, 3);
        const formattedResults = topResults
          .map((result, i) => `${i + 1}. ${result.content}`)
          .join('\n\n');

        response = `Here's what I found:\n\n${formattedResults}`;
      } else {
        response = `I couldn't find any relevant information for "${message}". Try rephrasing your question.`;
      }

      // Send response
      await activeChannel?.sendResponse(conversationId, response);
    });

    // Create and start server
    const server = new TACServer(tac, {
      development: true,
      voice: {
        port: Number(process.env.PORT) || 8000,
      },
    });

    await server.start();

    console.log('✅ Knowledge Search Bot is running!');
    console.log('');
    console.log('Configure your Twilio SMS webhook URL to:');
    console.log('http://your-domain.com/sms');
    console.log('');
    console.log('Send an SMS with your question to search the knowledge base.');

    // Graceful shutdown
    process.on('SIGINT', () => {
      void (async (): Promise<void> => {
        console.log('\n🛑 Shutting down...');
        await server.stop();
        process.exit(0);
      })();
    });
  } catch (error) {
    console.error('❌ Failed to start Knowledge Search bot:', error);
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
