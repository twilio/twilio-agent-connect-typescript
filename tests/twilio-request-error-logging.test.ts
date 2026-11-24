import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import pino from 'pino';
import Twilio from 'twilio';
import {
  ConversationClient,
  GPTLiveProviderConfig,
  OpenAIRealtimeProviderConfig,
  TAC,
  TACConfig,
  VoiceChannel,
} from '@twilio/tac-core';
import { TWILIO_AUDIO_FORMAT_FOR_GPT_LIVE } from '../packages/core/src/channels/voice/media-streams/gpt-live/provider';

const API_KEY = 'SK123';
const API_SECRET = 'test_api_secret';
const BASIC_AUTH = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');
const TO = '+15559998888';

let unreachableOrigin: string;

beforeAll(async () => {
  // A port that was just closed, so every request fails with ECONNREFUSED.
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>(resolve => server.close(() => resolve()));
  unreachableOrigin = `http://127.0.0.1:${port}`;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A real twilio-node client whose requests go to the unreachable origin. They
 * use axios's http adapter, not the suite's blocking one, so they fail the way
 * a real network error does.
 */
function unreachableTwilioClient(): ReturnType<typeof Twilio> {
  const client = Twilio(API_KEY, API_SECRET, { accountSid: 'ACtest123456789' });
  client.httpClient.axios.interceptors.request.use(config => ({
    ...config,
    adapter: 'http',
    url: config.url?.replace(/^https:\/\/[^/]+/, unreachableOrigin),
  }));
  return client;
}

async function createCapturingTAC(): Promise<{ tac: TAC; lines: string[] }> {
  vi.spyOn(ConversationClient.prototype, 'getConfiguration').mockResolvedValue({
    id: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
    description: 'test config',
    conversationGroupingType: 'GROUP_BY_PARTICIPANT_ADDRESSES',
  } as never);

  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const config = new TACConfig({
    accountSid: 'ACtest123456789',
    authToken: 'test_token_123',
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    phoneNumber: '+15551234567',
    conversationConfigurationId: 'conv_configuration_01kbjqhn79f0fvwfsxqzd5nqhd',
    voicePublicDomain: 'example.com',
  });
  const tac = await TAC.create({ config, logger: pino({ level: 'debug' }, stream) });
  return { tac, lines };
}

function useUnreachableTwilio(channel: VoiceChannel): void {
  const client = unreachableTwilioClient();
  vi.spyOn(
    channel as unknown as { getTwilioClient: () => typeof client },
    'getTwilioClient'
  ).mockReturnValue(client);
  vi.spyOn(channel, 'getTwilioClientInternal').mockReturnValue(client);
}

function expectOnlySafeFields(lines: string[], message: string): void {
  const line = lines.find(l => l.includes(message));
  expect(line).toBeDefined();
  expect(JSON.parse(line!)).toMatchObject({ code: 'ECONNREFUSED' });
  expect(JSON.parse(line!)).not.toHaveProperty('err');

  const output = lines.join('');
  expect(output).not.toContain(API_SECRET);
  expect(output).not.toContain(BASIC_AUTH);
  expect(output).not.toContain(encodeURIComponent(TO));
}

describe('Twilio REST request failures are logged without request config', () => {
  it('endCall', async () => {
    const { tac, lines } = await createCapturingTAC();
    const channel = new VoiceChannel(tac);
    useUnreachableTwilio(channel);

    await expect(channel.endCall('CA' + '0'.repeat(32))).resolves.toBe(false);

    expectOnlySafeFields(lines, 'Failed to hang up call');
  });

  it('ConversationRelay outbound call', async () => {
    const { tac, lines } = await createCapturingTAC();
    const channel = new VoiceChannel(tac);
    tac.registerChannel(channel);
    useUnreachableTwilio(channel);

    await expect(
      channel.initiateOutboundConversation({ to: TO, websocketUrl: 'wss://example.com/ws' })
    ).rejects.toThrow();

    expectOnlySafeFields(lines, 'Failed to initiate outbound call');
    expectOnlySafeFields(lines, 'Channel error');
  });

  it('OpenAI Realtime outbound call', async () => {
    const { tac, lines } = await createCapturingTAC();
    const channel = new VoiceChannel(
      tac,
      new OpenAIRealtimeProviderConfig({ openaiApiKey: 'sk-test' })
    );
    useUnreachableTwilio(channel);

    await expect(channel.initiateOutboundConversation({ to: TO })).rejects.toThrow();

    expectOnlySafeFields(lines, 'Failed to initiate outbound call');
  });

  it('GPT Live outbound call', async () => {
    const { tac, lines } = await createCapturingTAC();
    const channel = new VoiceChannel(
      tac,
      new GPTLiveProviderConfig({
        openaiApiKey: 'sk-test',
        defaultSessionConfig: {
          model: 'gpt-live-1',
          audio: { format: TWILIO_AUDIO_FORMAT_FOR_GPT_LIVE },
        },
      })
    );
    useUnreachableTwilio(channel);

    await expect(channel.initiateOutboundConversation({ to: TO })).rejects.toThrow();

    expectOnlySafeFields(lines, 'Failed to initiate outbound call');
  });
});
