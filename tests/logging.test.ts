import { describe, it, expect, vi, afterEach } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';
import MockAdapter from 'axios-mock-adapter';
import { TAC, TACConfig, TACConfigData, VoiceChannel, MemoryClient } from '@twilio/tac-core';
import { TACServer } from '@twilio/tac-server';
import { createTestTAC } from './helpers/tac';

const CUSTOMER = '+15559998888';
const AGENT = '+15551234567';

function getTestConfig(overrides: Partial<TACConfigData> = {}): TACConfigData {
  return {
    accountSid: 'ACtest123',
    authToken: 'test_token_123',
    apiKey: 'SK123',
    apiSecret: 'test_api_token',
    phoneNumber: AGENT,
    voicePublicDomain: 'example.com',
    ...overrides,
  };
}

function captureStream(): { stream: Writable; output: () => string } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { stream, output: () => lines.join('') };
}

function loggedArgs(spy: { mock: { calls: unknown[][] } }): string {
  return JSON.stringify(spy.mock.calls);
}

describe('logging hygiene', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not log the Recall query', async () => {
    const config = new TACConfig(getTestConfig());
    const client = new MemoryClient(config, 'mem_service_test');
    new MockAdapter((client as any).axiosInstance)
      .onPost(/Recall/)
      .reply(200, { observations: [], summaries: [], communications: [] });
    const debugSpy = vi.spyOn((client as any).logger, 'debug');

    await client.retrieveMemories('mem_profile_test', { query: 'my account password is hunter2' });

    expect(debugSpy).toHaveBeenCalled();
    expect(loggedArgs(debugSpy)).not.toContain('hunter2');
    expect(loggedArgs(debugSpy)).toContain('"has_query":true');
  });

  it('masks To and From when placing an outbound voice call', async () => {
    const tac = await createTestTAC(getTestConfig());
    const channel = new VoiceChannel(tac);
    vi.spyOn(channel, 'getTwilioClientInternal').mockReturnValue({
      calls: { create: vi.fn().mockResolvedValue({ sid: 'CA_out' }) },
    } as any);
    const logger = channel.getLoggerInternal();
    const spies = (['debug', 'info', 'warn', 'error'] as const).map(level =>
      vi.spyOn(logger, level)
    );

    await channel.initiateOutboundConversation({ to: CUSTOMER });

    const logged = spies.map(loggedArgs).join('');
    expect(logged).toContain('Initiating outbound voice conversation');
    expect(logged).not.toContain(CUSTOMER);
    expect(logged).not.toContain(AGENT);
    expect(logged).toContain('+1***8888');
  });

  it('drops message text and masks To from channel error logs', async () => {
    const tac = await createTestTAC(getTestConfig());
    const channel = new VoiceChannel(tac);
    tac.registerChannel(channel);
    const errorSpy = vi.spyOn(tac.logger, 'error');

    channel.handleErrorInternal(new Error('boom'), {
      conversationId: 'conv_1',
      message: 'my account password is hunter2',
      payload: { text: 'hunter2' },
      to: CUSTOMER,
    });

    const call = errorSpy.mock.calls.find(c => c[1] === 'Channel error');
    expect(call).toBeDefined();
    const context = call![0] as Record<string, unknown>;
    expect(context.conversationId).toBe('conv_1');
    expect(context.to).toBe('+1***8888');
    expect(JSON.stringify(context)).not.toContain('hunter2');
  });

  it('masks phone numbers and emails in an app-supplied logger and its children', async () => {
    const { stream, output } = captureStream();
    const tac = await TAC.create({
      config: getTestConfig(),
      logger: pino({ level: 'debug' }, stream),
    });

    tac.logger.info({ from: CUSTOMER }, 'inbound');
    tac.logger.child({ component: 'test' }).warn(`reply to user@example.com and ${CUSTOMER}`);

    expect(output()).not.toContain(CUSTOMER);
    expect(output()).not.toContain('user@example.com');
    expect(output()).toContain('+1***8888');
    expect(output()).toContain('u***@example.com');
  });

  it("masks phone numbers in TACServer's default Fastify logger", async () => {
    const tac = await createTestTAC(getTestConfig());
    const server = new TACServer(tac);
    const { stream, output } = captureStream();
    (server.fastify.log as any)[pino.symbols.streamSym] = stream;
    server.fastify.get('/log-test', async request => {
      request.log.info(`caller ${CUSTOMER}`);
      return 'ok';
    });

    server.fastify.log.info({ from: CUSTOMER }, 'server');
    await server.fastify.inject({ method: 'GET', url: '/log-test' });
    await server.fastify.close();

    expect(output()).toContain('server');
    expect(output()).toContain('caller +1***8888');
    expect(output()).not.toContain(CUSTOMER);
  });
});
