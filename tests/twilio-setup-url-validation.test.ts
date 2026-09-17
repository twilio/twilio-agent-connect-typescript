import { describe, it, expect } from 'vitest';
import { validateOperationStatusUrl } from '../getting_started/twilio-setup/src/validation';

describe('validateOperationStatusUrl', () => {
  it('accepts Memory and Conversation control-plane operation URLs', () => {
    expect(
      validateOperationStatusUrl('https://memory.twilio.com/v1/ControlPlane/Operations/op_123')
    ).toEqual({ url: 'https://memory.twilio.com/v1/ControlPlane/Operations/op_123' });

    expect(
      validateOperationStatusUrl(
        'https://conversations.twilio.com/v2/ControlPlane/Operations/op_123'
      )
    ).toEqual({ url: 'https://conversations.twilio.com/v2/ControlPlane/Operations/op_123' });
  });

  it('accepts an explicit default port', () => {
    const result = validateOperationStatusUrl(
      'https://memory.twilio.com:443/v1/ControlPlane/Operations/op_123'
    );
    expect(result.error).toBeUndefined();
  });

  it('rejects non-https schemes', () => {
    const result = validateOperationStatusUrl(
      'http://memory.twilio.com/v1/ControlPlane/Operations/op_123'
    );
    expect(result.url).toBeUndefined();
    expect(result.error).toBe('Invalid status_url scheme: http. Must be https.');
  });

  it('rejects hosts outside the allowlist', () => {
    expect(
      validateOperationStatusUrl('https://evil.com/v1/ControlPlane/Operations/op_123').error
    ).toContain('Invalid status_url host: evil.com');
  });

  it('rejects a lookalike host that only suffixes an allowed one', () => {
    const result = validateOperationStatusUrl(
      'https://memory.twilio.com.evil.com/v1/ControlPlane/Operations/op_123'
    );
    expect(result.url).toBeUndefined();
    expect(result.error).toContain('Invalid status_url host: memory.twilio.com.evil.com');
  });

  it('rejects a non-default port', () => {
    const result = validateOperationStatusUrl(
      'https://memory.twilio.com:8443/v1/ControlPlane/Operations/op_123'
    );
    expect(result.error).toBe('Invalid status_url port: 8443. Must be 443 or omitted.');
  });

  // `new URL()` collapses `..` while parsing, so checking URL.pathname here would let
  // this through. The check has to run against the raw input.
  it('rejects dot-segment path traversal even though URL parsing would collapse it', () => {
    const result = validateOperationStatusUrl(
      'https://memory.twilio.com/v1/ControlPlane/Operations/../Stores/abc'
    );
    expect(result.url).toBeUndefined();
    expect(result.error).toBe('Invalid status_url path: Path traversal detected.');
  });

  it('rejects percent-encoded path traversal', () => {
    const result = validateOperationStatusUrl(
      'https://memory.twilio.com/v1/ControlPlane/Operations/%2E%2E/Stores/abc'
    );
    expect(result.url).toBeUndefined();
    expect(result.error).toBe('Invalid status_url path: Path traversal detected.');
  });

  it('rejects a control-plane path that is not an Operations endpoint', () => {
    const result = validateOperationStatusUrl('https://memory.twilio.com/v1/Stores/abc');
    expect(result.error).toContain('Must be a ControlPlane Operations endpoint');
  });

  it('rejects the bare Operations collection with no operation id', () => {
    const result = validateOperationStatusUrl(
      'https://memory.twilio.com/v1/ControlPlane/Operations/'
    );
    expect(result.url).toBeUndefined();
    expect(result.error).toContain('Must be a ControlPlane Operations endpoint');
  });

  it('rejects an unparseable URL', () => {
    const result = validateOperationStatusUrl('not-a-url');
    expect(result.url).toBeUndefined();
    expect(result.error).toContain('Invalid status_url format:');
  });
});
