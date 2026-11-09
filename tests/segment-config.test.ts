import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as tac from '@twilio/tac-core';
import * as tools from '@twilio/tac-tools';
import { TACConfig } from '@twilio/tac-core';
import { segmentTestConfig } from './helpers/segment';

describe('Segment configuration', () => {
  describe('constructor', () => {
    it('should default region to us and identifier type to phone', () => {
      const config = new TACConfig({ ...segmentTestConfig() });

      expect(config.segmentRegion).toBe('us');
      expect(config.segmentIdentifierType).toBe('phone');
      expect(config.segmentSpaceId).toBe('spa_test123');
      expect(config.segmentProfileApiToken).toBe('profile_api_token');
    });

    it('should leave space ID and token undefined when not provided', () => {
      const { segmentSpaceId: _s, segmentProfileApiToken: _t, ...rest } = segmentTestConfig();
      const config = new TACConfig(rest);

      expect(config.segmentSpaceId).toBeUndefined();
      expect(config.segmentProfileApiToken).toBeUndefined();
    });

    it('should accept eu region and a custom identifier type', () => {
      const config = new TACConfig({
        ...segmentTestConfig(),
        segmentRegion: 'eu',
        segmentIdentifierType: 'user_id',
      });

      expect(config.segmentRegion).toBe('eu');
      expect(config.segmentIdentifierType).toBe('user_id');
    });

    it('should reject an unknown region', () => {
      expect(
        () => new TACConfig({ ...segmentTestConfig(), segmentRegion: 'ap' as never })
      ).toThrow();
    });

    it('should reject a malformed identifier type', () => {
      expect(
        () => new TACConfig({ ...segmentTestConfig(), segmentIdentifierType: 'bad type/..' })
      ).toThrow(/Invalid Segment identifier type/);
    });
  });

  describe('fromEnv', () => {
    const SEGMENT_VARS = [
      'SEGMENT_SPACE_ID',
      'SEGMENT_PROFILE_API_TOKEN',
      'SEGMENT_REGION',
      'SEGMENT_IDENTIFIER_TYPE',
    ];

    beforeEach(() => {
      vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACtest123456789');
      vi.stubEnv('TWILIO_AUTH_TOKEN', 'token');
      vi.stubEnv('TWILIO_API_KEY', 'key');
      vi.stubEnv('TWILIO_API_SECRET', 'secret');
      vi.stubEnv('TWILIO_PHONE_NUMBER', '+15551234567');
      SEGMENT_VARS.forEach(name => vi.stubEnv(name, ''));
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should load Segment settings from the environment', () => {
      vi.stubEnv('SEGMENT_SPACE_ID', 'spa_env');
      vi.stubEnv('SEGMENT_PROFILE_API_TOKEN', 'env_token');
      vi.stubEnv('SEGMENT_REGION', 'eu');
      vi.stubEnv('SEGMENT_IDENTIFIER_TYPE', 'email');

      const config = TACConfig.fromEnv();

      expect(config.segmentSpaceId).toBe('spa_env');
      expect(config.segmentProfileApiToken).toBe('env_token');
      expect(config.segmentRegion).toBe('eu');
      expect(config.segmentIdentifierType).toBe('email');
    });

    it('should treat empty values as unset and apply defaults', () => {
      const config = TACConfig.fromEnv();

      expect(config.segmentSpaceId).toBeUndefined();
      expect(config.segmentProfileApiToken).toBeUndefined();
      expect(config.segmentRegion).toBe('us');
      expect(config.segmentIdentifierType).toBe('phone');
    });

    it('should reject an invalid SEGMENT_REGION', () => {
      vi.stubEnv('SEGMENT_REGION', 'mars');

      expect(() => TACConfig.fromEnv()).toThrow();
    });
  });
});

describe('Segment exports', () => {
  it('should export the client, response wrapper, tools and tool name', () => {
    expect(tac.SegmentClient).toBeDefined();
    expect(tac.TACSegmentResponse).toBeDefined();
    expect(tac.BuiltInTools.GET_CUSTOMER_ACTIVITY).toBe('get_customer_activity');
    expect(tools.createSegmentActivityTool).toBeDefined();
    expect(tools.createSegmentTools).toBeDefined();
  });

  it('should validate segment modes with the exported schema', () => {
    expect(tac.SegmentModeSchema.safeParse('always').success).toBe(true);
    expect(tac.SegmentModeSchema.safeParse('sometimes').success).toBe(false);
  });
});
