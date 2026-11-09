import { describe, it, expect, vi } from 'vitest';
import { BuiltInTools, SegmentClient } from '@twilio/tac-core';
import { createSegmentActivityTool, createSegmentTools } from '@twilio/tac-tools';
import { makeEvent } from './helpers/segment';

function mockClient(events = [] as ReturnType<typeof makeEvent>[]) {
  const getProfileEvents = vi.fn().mockResolvedValue(events);
  return { client: { getProfileEvents } as unknown as SegmentClient, getProfileEvents };
}

describe('createSegmentActivityTool', () => {
  it('should expose the default name and an all-optional schema', () => {
    const { client } = mockClient();

    const tool = createSegmentActivityTool(client, '+15551234567');

    expect(tool.name).toBe(BuiltInTools.GET_CUSTOMER_ACTIVITY);
    expect(tool.name).toBe('get_customer_activity');
    expect(tool.parameters.required).toEqual([]);
    expect(Object.keys(tool.parameters.properties ?? {})).toEqual(['eventNames', 'since', 'limit']);
  });

  it('should allow overriding name and description', () => {
    const { client } = mockClient();

    const tool = createSegmentActivityTool(client, '+1', { name: 'activity', description: 'd' });

    expect(tool.name).toBe('activity');
    expect(tool.description).toBe('d');
  });

  it('should convert to OpenAI and Anthropic formats', () => {
    const { client } = mockClient();
    const tool = createSegmentActivityTool(client, '+1');

    expect(tool.toOpenAIFormat().function.name).toBe('get_customer_activity');
    expect(tool.toAnthropicFormat().name).toBe('get_customer_activity');
  });

  it('should query the client with the identity and a default limit of 10', async () => {
    const { client, getProfileEvents } = mockClient();
    const identity = { type: 'phone', value: '+15551234567' };

    await createSegmentActivityTool(client, identity).implementation({});

    expect(getProfileEvents).toHaveBeenCalledWith(identity, { limit: 10 });
  });

  it('should pass through eventNames, since and limit', async () => {
    const { client, getProfileEvents } = mockClient();

    await createSegmentActivityTool(client, '+1').implementation({
      eventNames: ['Application Submitted'],
      since: '2026-11-01T00:00:00Z',
      limit: 3,
    });

    expect(getProfileEvents).toHaveBeenCalledWith('+1', {
      limit: 3,
      eventNames: ['Application Submitted'],
      since: '2026-11-01T00:00:00Z',
    });
  });

  it('should not forward empty eventNames', async () => {
    const { client, getProfileEvents } = mockClient();

    await createSegmentActivityTool(client, '+1').implementation({ eventNames: [] });

    expect(getProfileEvents).toHaveBeenCalledWith('+1', { limit: 10 });
  });

  it('should return compact events', async () => {
    const { client } = mockClient([
      makeEvent({
        event: 'Application Submitted',
        timestamp: '2026-11-09T10:00:00Z',
        properties: { product: 'Gold Card' },
        context: { ip: '1.2.3.4' },
      } as never),
      makeEvent({ type: 'page', timestamp: '2026-11-09T09:00:00Z' }),
    ]);

    const result = await createSegmentActivityTool(client, '+1').implementation({});

    expect(result).toEqual([
      {
        event: 'Application Submitted',
        type: 'track',
        timestamp: '2026-11-09T10:00:00Z',
        properties: { product: 'Gold Card' },
      },
      { event: 'page', type: 'page', timestamp: '2026-11-09T09:00:00Z', properties: undefined },
    ]);
  });

  it('should drop non-allowlisted properties', async () => {
    const { client } = mockClient([
      makeEvent({
        event: 'X',
        timestamp: '2026-11-09T10:00:00Z',
        properties: { product: 'Gold Card', ssn: '123' },
      }),
      makeEvent({ event: 'Y', timestamp: '2026-11-09T09:00:00Z', properties: { ssn: '123' } }),
    ]);

    const result = await createSegmentActivityTool(client, '+1', {
      propertyAllowlist: ['product'],
    }).implementation({});

    expect(result[0]?.properties).toEqual({ product: 'Gold Card' });
    expect(result[1]?.properties).toBeUndefined();
  });

  it('should throw when no identity is available', async () => {
    const { client, getProfileEvents } = mockClient();

    await expect(createSegmentActivityTool(client).implementation({})).rejects.toThrow(
      /No customer identity/
    );
    expect(getProfileEvents).not.toHaveBeenCalled();
  });

  it('should propagate client errors', async () => {
    const { client, getProfileEvents } = mockClient();
    getProfileEvents.mockRejectedValue(new Error('Failed to get Segment events: boom'));

    await expect(createSegmentActivityTool(client, '+1').implementation({})).rejects.toThrow(
      /boom/
    );
  });
});

describe('createSegmentTools', () => {
  it('should create a tool bound to an identity via forIdentity()', async () => {
    const { client, getProfileEvents } = mockClient();

    const tool = createSegmentTools(client).forIdentity({ type: 'email', value: 'a@b.com' });
    await tool.implementation({ limit: 2 });

    expect(tool.name).toBe('get_customer_activity');
    expect(getProfileEvents).toHaveBeenCalledWith(
      { type: 'email', value: 'a@b.com' },
      { limit: 2 }
    );
  });
});
