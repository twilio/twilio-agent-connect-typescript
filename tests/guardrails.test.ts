import { describe, it, expect } from 'vitest';
import { GuardrailError } from '@twilio/tac-tools';

describe('GuardrailError', () => {
  it('is an instance of Error', () => {
    const err = new GuardrailError('blocked', 'rate_limit');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name GuardrailError', () => {
    const err = new GuardrailError('blocked', 'rate_limit');
    expect(err.name).toBe('GuardrailError');
  });

  it('exposes the type field', () => {
    expect(new GuardrailError('x', 'rate_limit').type).toBe('rate_limit');
    expect(new GuardrailError('x', 'content_filter').type).toBe('content_filter');
  });

  it('sets the message', () => {
    const err = new GuardrailError('too many calls', 'rate_limit');
    expect(err.message).toBe('too many calls');
  });
});
