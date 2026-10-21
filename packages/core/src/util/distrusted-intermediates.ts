/**
 * Rejects TLS connections whose certificate chain contains one of eight eMudhra intermediate CA
 * certificates whose private keys are compromised (CVE-2026-111943). Anyone can use those keys to issue
 * a certificate that default trust stores accept.
 *
 * Each certificate is identified by the SHA-256 of its DER-encoded SubjectPublicKeyInfo. See
 * https://emudhra.we-have-a-problem.com for the published list.
 *
 * Remove this once the Node.js runtime distrusts these intermediates.
 */

import * as crypto from 'node:crypto';
import * as https from 'node:https';
import * as tls from 'node:tls';

export const DISTRUSTED_SPKI_SHA256: ReadonlySet<string> = new Set([
  'ebed6475c2c2d80fcb199f3fe8dd6e6b3ce60b77eb15d4e42c3dec0c6f5b5105',
  '49dd353dc2b919a3770645117d0e60c16115e7d1bc259eefe734b00ea434fe5f',
  'e0254c7fcdc265e2f0f8a428dabb75ab4ae039b4872d62f5ee57f0877d5a8a41',
  '5c0660a2b164910d8ff589c18e14552e9e0ec237dcefe2cb736d41a4811f81a0',
  '43bffa19d6ef651451f6841e019931e96f6f2eaeff28ab4b6f1ce4576de2717b',
  '63ecefee431d49523bc1136c4e72d0206a477086caf606cd5cf025686c109cf8',
  'ec4ffa1ad0ac88081314b7aaffef6a91f97cd57291bb5ba686c5415f5eb4f6b6',
  '92c063d67e8f14db71d288e11266ffdaf69cbf115f7bab14f3bc2f68d25e0e30',
]);

/** SHA-256 (hex) of a certificate's DER-encoded SubjectPublicKeyInfo. */
export function spkiSha256(raw: Buffer): string {
  const spki = new crypto.X509Certificate(raw).publicKey.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(spki).digest('hex');
}

/**
 * Whether the peer certificate, or any certificate it chains to, is distrusted. The peer certificate
 * links to its issuers through `issuerCertificate`; a self-signed root points at itself.
 */
export function containsDistrusted(
  peerCertificate: tls.DetailedPeerCertificate | undefined,
  distrusted: ReadonlySet<string> = DISTRUSTED_SPKI_SHA256
): boolean {
  const seen = new Set<tls.DetailedPeerCertificate>();
  for (
    let cert = peerCertificate;
    cert && cert.raw && !seen.has(cert);
    cert = cert.issuerCertificate
  ) {
    seen.add(cert);
    if (distrusted.has(spkiSha256(cert.raw))) {
      return true;
    }
  }
  return false;
}

/**
 * A `checkServerIdentity` that rejects distrusted chains, then applies Node's default hostname
 * verification.
 */
export function checkServerIdentity(
  hostname: string,
  cert: tls.PeerCertificate
): Error | undefined {
  if (containsDistrusted(cert as tls.DetailedPeerCertificate)) {
    const error = new Error(
      `Certificate chain for ${hostname} contains a distrusted intermediate certificate`
    ) as NodeJS.ErrnoException;
    error.code = 'ERR_TLS_CERT_DISTRUSTED';
    return error;
  }
  return tls.checkServerIdentity(hostname, cert);
}

/** An https agent that refuses distrusted chains. */
export function createDistrustingHttpsAgent(): https.Agent {
  return new https.Agent({ checkServerIdentity });
}
