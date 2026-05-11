import { vi, afterEach } from 'vitest';
import { TAC, TACConfig, TACConfigData, ConversationClient } from '@twilio/tac-core';

const spies: Array<ReturnType<typeof vi.spyOn>> = [];

afterEach(() => {
  spies.forEach(spy => spy.mockRestore());
  spies.length = 0;
});

/**
 * Create a TAC instance for testing with mocked conversation config API.
 *
 * @param configOrData - TAC configuration instance or raw data
 * @param memoryStoreIdFromConfig - Optional memory store ID from conversation config (simulates API response)
 * @returns TAC instance
 */
export async function createTestTAC(
  configOrData: TACConfig | TACConfigData,
  memoryStoreIdFromConfig: string | null = 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg'
): Promise<TAC> {
  const config = configOrData instanceof TACConfig ? configOrData : new TACConfig(configOrData);

  // Mock ConversationClient.getConfiguration to avoid real API calls
  const mockGetConfiguration = vi.fn().mockResolvedValue({
    id: config.conversationConfigurationId,
    description: 'test config',
    conversationGroupingType: 'GROUP_BY_PARTICIPANT_ADDRESSES' as const,
    memoryStoreId: memoryStoreIdFromConfig ?? undefined,
  });

  const spy = vi.spyOn(ConversationClient.prototype, 'getConfiguration').mockImplementation(mockGetConfiguration);
  spies.push(spy);

  // Create TAC instance (will use mocked getConfiguration)
  const tac = await TAC.create({ config });

  return tac;
}

/**
 * Initialize TAC with memory enabled (for tests that need memory functionality).
 *
 * @param configOrData - TAC configuration instance or raw data
 * @returns TAC instance with memory enabled
 */
export async function createTestTACWithMemory(configOrData: TACConfig | TACConfigData): Promise<TAC> {
  return createTestTAC(configOrData, 'mem_service_01kbjqhhdpft0tbp21jt4ktbxg');
}
