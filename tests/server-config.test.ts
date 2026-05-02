import { describe, it, expect } from 'vitest';
import { TACServerConfig } from '@twilio/tac-server';

describe('TACServerConfig publicDomain validation', () => {
  it('should reject http:// protocol in publicDomain', () => {
    expect(() => {
      new TACServerConfig({
        publicDomain: 'http://example.ngrok.io',
      });
    }).toThrow(/publicDomain must be a valid domain/);
  });

  it('should reject https:// protocol in publicDomain', () => {
    expect(() => {
      new TACServerConfig({
        publicDomain: 'https://example.ngrok.io',
      });
    }).toThrow(/publicDomain must be a valid domain/);
  });

  it('should reject trailing slashes in publicDomain', () => {
    expect(() => {
      new TACServerConfig({
        publicDomain: 'example.ngrok.io///',
      });
    }).toThrow(/publicDomain must be a valid domain/);
  });

  it('should reject publicDomain with paths', () => {
    expect(() => {
      new TACServerConfig({
        publicDomain: 'example.ngrok.io/path',
      });
    }).toThrow(/publicDomain must be a valid domain/);
  });

  it('should reject publicDomain with query strings', () => {
    expect(() => {
      new TACServerConfig({
        publicDomain: 'example.ngrok.io?foo=bar',
      });
    }).toThrow(/publicDomain must be a valid domain/);
  });

  it('should reject publicDomain with fragments', () => {
    expect(() => {
      new TACServerConfig({
        publicDomain: 'example.ngrok.io#section',
      });
    }).toThrow(/publicDomain must be a valid domain/);
  });

  it('should reject publicDomain with whitespace', () => {
    expect(() => {
      new TACServerConfig({
        publicDomain: ' example.ngrok.io ',
      });
    }).toThrow(/publicDomain must be a valid domain/);
  });

  it('should reject invalid domain format', () => {
    expect(() => {
      new TACServerConfig({
        publicDomain: 'not a valid domain!',
      });
    }).toThrow(/publicDomain must be a valid domain/);
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

  it('should reject webhook paths with trailing whitespace', () => {
    expect(() => {
      new TACServerConfig({
        messagingWebhookPath: '/webhook ',
      });
    }).toThrow(/messagingWebhookPath must start with/);
  });

  it('should reject webhook paths with leading whitespace', () => {
    expect(() => {
      new TACServerConfig({
        twimlPath: ' /twiml',
      });
    }).toThrow(/twimlPath must start with/);
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

describe('TACServerConfig.fromEnv() port validation', () => {
  const originalEnv = process.env.TWILIO_SERVER_PORT;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TWILIO_SERVER_PORT = originalEnv;
    } else {
      delete process.env.TWILIO_SERVER_PORT;
    }
  });

  it('should reject non-numeric port values', () => {
    process.env.TWILIO_SERVER_PORT = 'abc';
    expect(() => {
      TACServerConfig.fromEnv();
    }).toThrow(/Invalid TWILIO_SERVER_PORT.*expected an integer between 1-65535/);
  });

  it('should reject partial numeric port values', () => {
    process.env.TWILIO_SERVER_PORT = '8000abc';
    expect(() => {
      TACServerConfig.fromEnv();
    }).toThrow(/Invalid TWILIO_SERVER_PORT.*expected an integer between 1-65535/);
  });

  it('should reject port 0', () => {
    process.env.TWILIO_SERVER_PORT = '0';
    expect(() => {
      TACServerConfig.fromEnv();
    }).toThrow(/Invalid TWILIO_SERVER_PORT.*expected an integer between 1-65535/);
  });

  it('should reject port above 65535', () => {
    process.env.TWILIO_SERVER_PORT = '70000';
    expect(() => {
      TACServerConfig.fromEnv();
    }).toThrow(/Invalid TWILIO_SERVER_PORT.*expected an integer between 1-65535/);
  });

  it('should accept valid port numbers', () => {
    process.env.TWILIO_SERVER_PORT = '8080';
    const config = TACServerConfig.fromEnv();
    expect(config.port).toBe(8080);
  });
});
