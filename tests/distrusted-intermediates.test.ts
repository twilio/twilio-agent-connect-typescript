/**
 * Distrusted intermediate certificate tests
 */
import { describe, it, expect } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as tls from 'node:tls';
import { TACConfig } from '../packages/core/src/lib/config';
import { KnowledgeClient } from '../packages/core/src/clients/knowledge';
import {
  DISTRUSTED_SPKI_SHA256,
  checkServerIdentity,
  containsDistrusted,
  createDistrustingHttpsAgent,
  spkiSha256,
} from '../packages/core/src/util/distrusted-intermediates';

const KNOWN_SPKI = 'ebed6475c2c2d80fcb199f3fe8dd6e6b3ce60b77eb15d4e42c3dec0c6f5b5105';
const raw = new crypto.X509Certificate(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'distrusted-intermediate.pem'))
).raw;
const otherRaw = new crypto.X509Certificate(tls.rootCertificates[0]!).raw;

function cert(fields: Record<string, unknown>): tls.DetailedPeerCertificate {
  return fields as unknown as tls.DetailedPeerCertificate;
}

describe('distrusted intermediates', () => {
  it('lists the eight compromised intermediates', () => {
    expect(DISTRUSTED_SPKI_SHA256.size).toBe(8);
  });

  it('hashes the SubjectPublicKeyInfo of a certificate', () => {
    expect(spkiSha256(raw)).toBe(KNOWN_SPKI);
  });

  it('detects a distrusted intermediate anywhere in the chain', () => {
    const root = cert({ raw: otherRaw });
    root.issuerCertificate = root;
    const leaf = cert({ raw: otherRaw, issuerCertificate: cert({ raw, issuerCertificate: root }) });
    expect(containsDistrusted(leaf)).toBe(true);
  });

  it('does not flag a chain without a distrusted certificate', () => {
    expect(containsDistrusted(cert({ raw: otherRaw }))).toBe(false);
    expect(containsDistrusted(cert({ raw }), new Set(['00']))).toBe(false);
    expect(containsDistrusted(undefined)).toBe(false);
  });

  it('checkServerIdentity rejects a distrusted chain', () => {
    const error = checkServerIdentity('example.com', cert({ raw })) as NodeJS.ErrnoException;
    expect(error.code).toBe('ERR_TLS_CERT_DISTRUSTED');
    expect(error.message).toContain('example.com');
  });

  it('checkServerIdentity still verifies the hostname otherwise', () => {
    const error = checkServerIdentity(
      'example.com',
      cert({ raw: otherRaw, subject: { CN: 'other.example' } })
    ) as NodeJS.ErrnoException;
    expect(error.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
  });

  it('installs the check on the https agent', () => {
    const agent = createDistrustingHttpsAgent();
    expect(agent.options.checkServerIdentity).toBe(checkServerIdentity);
  });

  it('installs the check on API client requests', () => {
    const config = new TACConfig({
      accountSid: 'ACtest',
      authToken: 'test_auth_token',
      phoneNumber: '+15555555555',
      apiKey: 'SKtest',
      apiSecret: 'test_token',
      conversationConfigurationId: 'conv_configuration_00000000000000000000000000',
    });
    const client = new KnowledgeClient(config);
    const agent = (client as any).axiosInstance.defaults.httpsAgent;
    expect(agent.options.checkServerIdentity).toBe(checkServerIdentity);
  });
});
