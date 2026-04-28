/**
 * Feature: Handoff to Human Agent
 *
 * Demonstrates TAC's handoff tool routing a conversation to a human agent via
 * a Twilio Studio Flow (for example, one that routes to Flex). Works on voice
 * and SMS.
 *
 * Requires `TWILIO_STUDIO_HANDOFF_FLOW_SID` in addition to the usual TAC env
 * vars — see `.env.example`.
 */

import { config } from 'dotenv';
import { Agent, AgentInputItem, run, setTracingDisabled } from '@openai/agents';
import {
  TAC,
  TACConfig,
  VoiceChannel,
  SMSChannel,
  ConversationSession,
  ConversationId,
  ChannelType,
  ProfileId,
  TACServer,
  TACMemoryResponse,
  createStudioHandoffTool,
} from 'twilio-agent-connect';

config({ path: '../../.env' });
setTracingDisabled(true);

const tac = await TAC.create({ config: TACConfig.fromEnv() });
const voiceChannel = new VoiceChannel(tac);
const smsChannel = new SMSChannel(tac);

tac.registerChannel(voiceChannel);
tac.registerChannel(smsChannel);

const SYSTEM_INSTRUCTIONS =
  'You are a helpful customer service agent. ' +
  'If the user asks to speak with a human, or if you cannot resolve ' +
  'their issue, use the handoff tool to transfer them to a human agent.';

// Example app-defined routing metadata attached to every handoff. Keys and
// values are arbitrary — pick whatever your downstream system expects. For
// Flex, these surface as TaskRouter task attributes.
const HANDOFF_ATTRIBUTES = {
  department: 'support',
  priority: 'normal',
};

const conversationHistory: Record<string, AgentInputItem[]> = {};

async function handleMessageReady(params: {
  conversationId: ConversationId;
  profileId: ProfileId | undefined;
  message: string;
  author: string;
  memory: TACMemoryResponse | undefined;
  session: ConversationSession;
  channel: ChannelType;
}): Promise<string | undefined> {
  const { conversationId, message, session } = params;
  const convId = conversationId as string;

  const handoffTool = createStudioHandoffTool(tac, session, {
    attributes: HANDOFF_ATTRIBUTES,
  });

  const agent = new Agent({
    name: 'Customer Service Agent',
    instructions: SYSTEM_INSTRUCTIONS,
    model: 'gpt-5.4-mini',
    tools: [await handoffTool.toOpenAIAgentsSDKTool()],
  });

  const history = conversationHistory[convId] ?? [];
  const agentInput: AgentInputItem[] = [...history, { role: 'user', content: message }];

  const result = await run(agent, agentInput);

  conversationHistory[convId] = result.history;
  return result.finalOutput;
}

tac.onMessageReady(handleMessageReady);

const server = new TACServer(tac, {
  voice: { host: '0.0.0.0', port: 8000 },
  development: true,
});

server
  .start()
  .then(() => {
    console.log('Server started successfully');
  })
  .catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
