import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { serializeError } from '../getting_started/twilio-setup/src/twilio-api';

describe('serializeError', () => {
  it('drops the request config, which carries the Basic Authorization header', () => {
    const config = {
      method: 'get',
      url: 'https://memory.twilio.com/v1/ControlPlane/Stores',
      headers: new AxiosHeaders({ Authorization: 'Basic U0tzZWNyZXQ6c2VjcmV0' }),
    } as InternalAxiosRequestConfig;
    const error = new AxiosError('connect ECONNREFUSED', 'ECONNREFUSED', config);

    const serialized = serializeError(error);

    expect(JSON.stringify(serialized)).not.toContain('U0tzZWNyZXQ6c2VjcmV0');
    expect(serialized).toMatchObject({
      type: 'AxiosError',
      message: 'connect ECONNREFUSED',
      code: 'ECONNREFUSED',
      method: 'get',
      url: 'https://memory.twilio.com/v1/ControlPlane/Stores',
    });
    expect(serialized).not.toHaveProperty('config');
    expect(serialized).not.toHaveProperty('request');
  });

  it('serializes other errors normally', () => {
    expect(serializeError(new TypeError('boom'))).toMatchObject({
      type: 'TypeError',
      message: 'boom',
    });
  });
});
