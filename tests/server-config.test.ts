import { describe, it, expect } from 'vitest';
import { TACServerConfig } from '../packages/server/src/lib/config';

describe('TACServerConfig publicDomain validation', () => {
  it('should strip http:// protocol from publicDomain', () => {
    const config = new TACServerConfig({
      publicDomain: 'http://example.ngrok.io',
    });
    expect(config.publicDomain).toBe('example.ngrok.io');
  });

  it('should strip https:// protocol from publicDomain', () => {
    const config = new TACServerConfig({
      publicDomain: 'https://example.ngrok.io',
    });
    expect(config.publicDomain).toBe('example.ngrok.io');
  });

  it('should strip trailing slashes from publicDomain', () => {
    const config = new TACServerConfig({
      publicDomain: 'example.ngrok.io///',
    });
    expect(config.publicDomain).toBe('example.ngrok.io');
  });

  it('should handle protocol and trailing slashes together', () => {
    const config = new TACServerConfig({
      publicDomain: 'https://example.ngrok.io/',
    });
    expect(config.publicDomain).toBe('example.ngrok.io');
  });

  it('should reject publicDomain with paths', () => {
    expect(() => {
      new TACServerConfig({
        publicDomain: 'example.ngrok.io/path',
      });
    }).toThrow('publicDomain must be a domain only');
  });

  it('should reject publicDomain with protocol after stripping', () => {
    expect(() => {
      new TACServerConfig({
        publicDomain: 'example://bad',
      });
    }).toThrow('publicDomain must be a domain only');
  });

  it('should allow empty publicDomain', () => {
    const config = new TACServerConfig({
      publicDomain: '',
    });
    expect(config.publicDomain).toBe('');
  });

  it('should allow valid domain names', () => {
    const config = new TACServerConfig({
      publicDomain: 'taf-prod.ngrok.app',
    });
    expect(config.publicDomain).toBe('taf-prod.ngrok.app');
  });
});

describe('TACServerConfig webhook path validation', () => {
  it('should reject messagingWebhookPath without leading slash', () => {
    expect(() => {
      new TACServerConfig({
        messagingWebhookPath: 'webhook',
      });
    }).toThrow(/messagingWebhookPath must start with/);
  });

  it('should reject twimlPath without leading slash', () => {
    expect(() => {
      new TACServerConfig({
        twimlPath: 'twiml',
      });
    }).toThrow(/twimlPath must start with/);
  });

  it('should reject websocketPath without leading slash', () => {
    expect(() => {
      new TACServerConfig({
        websocketPath: 'ws',
      });
    }).toThrow(/websocketPath must start with/);
  });

  it('should reject conversationRelayCallbackPath without leading slash', () => {
    expect(() => {
      new TACServerConfig({
        conversationRelayCallbackPath: 'callback',
      });
    }).toThrow(/conversationRelayCallbackPath must start with/);
  });

  it('should reject cintelWebhookPath without leading slash', () => {
    expect(() => {
      new TACServerConfig({
        cintelWebhookPath: 'ci-webhook',
      });
    }).toThrow(/cintelWebhookPath must start with/);
  });

  it('should accept valid webhook paths with leading slash', () => {
    const config = new TACServerConfig({
      messagingWebhookPath: '/my-webhook',
      twimlPath: '/my-twiml',
      websocketPath: '/my-ws',
      conversationRelayCallbackPath: '/my-callback',
      cintelWebhookPath: '/my-ci',
    });

    expect(config.messagingWebhookPath).toBe('/my-webhook');
    expect(config.twimlPath).toBe('/my-twiml');
    expect(config.websocketPath).toBe('/my-ws');
    expect(config.conversationRelayCallbackPath).toBe('/my-callback');
    expect(config.cintelWebhookPath).toBe('/my-ci');
  });
});
