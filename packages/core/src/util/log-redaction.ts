const PHONE_RE = /\+\d[\d\-\s()]{6,}\d/g;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

function scrubPhoneMatch(match: string): string {
  const digits = match.replace(/[\s\-()]/g, '');
  if (digits.length < 8) return '***';
  return `${digits.slice(0, 2)}***${digits.slice(-4)}`;
}

function scrubEmailMatch(match: string): string {
  const atIndex = match.indexOf('@');
  if (atIndex <= 0) return '***';
  return `${match[0]}***${match.slice(atIndex)}`;
}

export function scrubPii(value: string): string {
  return value.replace(PHONE_RE, scrubPhoneMatch).replace(EMAIL_RE, scrubEmailMatch);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scrubObject(obj: any): any {
  if (typeof obj === 'string') return scrubPii(obj);
  if (Array.isArray(obj)) return obj.map(scrubObject);
  if (obj !== null && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      out[key] = scrubObject(obj[key]);
    }
    return out;
  }
  return obj;
}

export function maskPhone(phone: string): string {
  if (!phone || !phone.startsWith('+') || phone.length < 8) {
    return '***';
  }
  return `${phone.slice(0, 2)}***${phone.slice(-4)}`;
}

export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) {
    return '***';
  }
  return `${email[0]}***${email.slice(atIndex)}`;
}

export function maskAddress(address: string): string {
  if (!address) return '***';
  if (address.includes('@')) return maskEmail(address);
  if (address.startsWith('+')) return maskPhone(address);
  if (address.length <= 1) return '***';
  return `${address[0]}***`;
}
