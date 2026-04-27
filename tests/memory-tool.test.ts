import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryRetrievalTool } from '@twilio/tac-tools';
import { MemoryClient } from '@twilio/tac-core';
import type { MemoryRetrievalResponse } from '@twilio/tac-core';

describe('Memory Retrieval Tool', () => {
  let mockMemoryClient: MemoryClient;
  const serviceSid = 'mem_service_test123';
  const profileId = 'mem_profile_test456';

  beforeEach(() => {
    // Create a mock memory client
    mockMemoryClient = {
      retrieveMemories: vi.fn(),
    } as unknown as MemoryClient;
  });

  describe('createMemoryRetrievalTool', () => {
    it('should create a tool with correct name and description', () => {
      const tool = createMemoryRetrievalTool(mockMemoryClient, serviceSid, profileId);

      expect(tool.name).toBe('retrieve_profile_memory');
      expect(tool.description).toBe(
        'Retrieve user memories including observations, summaries, and conversation history'
      );
    });

    it('should have correct parameter schema with camelCase names', () => {
      const tool = createMemoryRetrievalTool(mockMemoryClient, serviceSid, profileId);

      expect(tool.parameters.properties).toHaveProperty('query');
      expect(tool.parameters.properties).toHaveProperty('beginDate');
      expect(tool.parameters.properties).toHaveProperty('endDate');
      expect(tool.parameters.properties).toHaveProperty('observationsLimit');
      expect(tool.parameters.properties).toHaveProperty('summariesLimit');
      expect(tool.parameters.properties).toHaveProperty('communicationsLimit');
      expect(tool.parameters.properties).toHaveProperty('relevanceThreshold');
    });

    it('should pass empty request when no params provided', async () => {
      const mockResponse: MemoryRetrievalResponse = {
        observations: [],
        summaries: [],
        communications: [],
      };

      vi.mocked(mockMemoryClient.retrieveMemories).mockResolvedValue(mockResponse);

      const tool = createMemoryRetrievalTool(mockMemoryClient, serviceSid, profileId);
      await tool.implementation({});

      expect(mockMemoryClient.retrieveMemories).toHaveBeenCalledWith(serviceSid, profileId, {});
    });

    it('should call retrieveMemories with custom values when params provided', async () => {
      const mockResponse: MemoryRetrievalResponse = {
        observations: [],
        summaries: [],
        communications: [],
      };

      vi.mocked(mockMemoryClient.retrieveMemories).mockResolvedValue(mockResponse);

      const tool = createMemoryRetrievalTool(mockMemoryClient, serviceSid, profileId);
      await tool.implementation({
        query: 'test query',
        observationsLimit: 10,
        summariesLimit: 3,
        communicationsLimit: 5,
        relevanceThreshold: 0.7,
      });

      expect(mockMemoryClient.retrieveMemories).toHaveBeenCalledWith(
        serviceSid,
        profileId,
        expect.objectContaining({
          query: 'test query',
          observationsLimit: 10,
          summariesLimit: 3,
          communicationsLimit: 5,
          relevanceThreshold: 0.7,
        })
      );
    });

    it('should pass date fields with camelCase naming', async () => {
      const mockResponse: MemoryRetrievalResponse = {
        observations: [],
        summaries: [],
        communications: [],
      };

      vi.mocked(mockMemoryClient.retrieveMemories).mockResolvedValue(mockResponse);

      const tool = createMemoryRetrievalTool(mockMemoryClient, serviceSid, profileId);
      await tool.implementation({
        beginDate: '2024-01-01T00:00:00Z',
        endDate: '2024-12-31T23:59:59Z',
      });

      expect(mockMemoryClient.retrieveMemories).toHaveBeenCalledWith(
        serviceSid,
        profileId,
        expect.objectContaining({
          beginDate: '2024-01-01T00:00:00Z',
          endDate: '2024-12-31T23:59:59Z',
        })
      );
    });

    it('should throw error when profileId is missing', async () => {
      const tool = createMemoryRetrievalTool(mockMemoryClient, serviceSid);

      await expect(tool.implementation({})).rejects.toThrow('No profile ID available for memory retrieval');
    });

    it('should return memory response with observations and summaries', async () => {
      const mockResponse: MemoryRetrievalResponse = {
        observations: [
          {
            id: 'obs_1',
            content: 'Test observation',
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
        summaries: [
          {
            id: 'sum_1',
            content: 'Test summary',
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
        communications: [],
      };

      vi.mocked(mockMemoryClient.retrieveMemories).mockResolvedValue(mockResponse);

      const tool = createMemoryRetrievalTool(mockMemoryClient, serviceSid, profileId);
      const result = await tool.implementation({});

      expect(result).toEqual(mockResponse);
      expect(result.observations).toHaveLength(1);
      expect(result.summaries).toHaveLength(1);
    });

    it('should pass through query parameter correctly', async () => {
      const mockResponse: MemoryRetrievalResponse = {
        observations: [],
        summaries: [],
        communications: [],
      };

      vi.mocked(mockMemoryClient.retrieveMemories).mockResolvedValue(mockResponse);

      const tool = createMemoryRetrievalTool(mockMemoryClient, serviceSid, profileId);
      await tool.implementation({
        query: 'customer preferences',
      });

      expect(mockMemoryClient.retrieveMemories).toHaveBeenCalledWith(
        serviceSid,
        profileId,
        expect.objectContaining({
          query: 'customer preferences',
        })
      );
    });

    it('should handle zero values for limits', async () => {
      const mockResponse: MemoryRetrievalResponse = {
        observations: [],
        summaries: [],
        communications: [],
      };

      vi.mocked(mockMemoryClient.retrieveMemories).mockResolvedValue(mockResponse);

      const tool = createMemoryRetrievalTool(mockMemoryClient, serviceSid, profileId);
      await tool.implementation({
        observationsLimit: 0,
        summariesLimit: 0,
        communicationsLimit: 0,
      });

      expect(mockMemoryClient.retrieveMemories).toHaveBeenCalledWith(
        serviceSid,
        profileId,
        expect.objectContaining({
          observationsLimit: 0,
          summariesLimit: 0,
          communicationsLimit: 0,
        })
      );
    });

    it('should handle boundary values for relevance threshold', async () => {
      const mockResponse: MemoryRetrievalResponse = {
        observations: [],
        summaries: [],
        communications: [],
      };

      vi.mocked(mockMemoryClient.retrieveMemories).mockResolvedValue(mockResponse);

      const tool = createMemoryRetrievalTool(mockMemoryClient, serviceSid, profileId);

      // Test minimum boundary
      await tool.implementation({ relevanceThreshold: 0.0 });
      expect(mockMemoryClient.retrieveMemories).toHaveBeenCalledWith(
        serviceSid,
        profileId,
        expect.objectContaining({
          relevanceThreshold: 0.0,
        })
      );

      // Test maximum boundary
      await tool.implementation({ relevanceThreshold: 1.0 });
      expect(mockMemoryClient.retrieveMemories).toHaveBeenCalledWith(
        serviceSid,
        profileId,
        expect.objectContaining({
          relevanceThreshold: 1.0,
        })
      );
    });
  });
});
