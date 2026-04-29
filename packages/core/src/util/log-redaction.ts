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
  // Fresh RegExp each call — avoids lastIndex state bugs from the g flag
  const phoneRe = /\+\d[\d\s()-]{6,}\d/g;
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  return value.replace(phoneRe, scrubPhoneMatch).replace(emailRe, scrubEmailMatch);
}

export function scrubObject(obj: unknown, seen?: WeakSet<object>): unknown {
  if (typeof obj === 'string') return scrubPii(obj);
  if (obj === null || typeof obj !== 'object') return obj;

  const visited = seen ?? new WeakSet<object>();
  if (visited.has(obj)) return '[Circular]';
  visited.add(obj);

  if (obj instanceof Error) {
    const record = obj as unknown as Record<string, unknown>;
    const scrubbed = Object.create(Object.getPrototypeOf(obj) as object) as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      scrubbed[key] = scrubObject(record[key], visited);
    }
    const result = scrubbed as unknown as Error;
    if (!Object.prototype.hasOwnProperty.call(scrubbed, 'message')) {
      result.message = scrubPii(obj.message);
    }
    if (!Object.prototype.hasOwnProperty.call(scrubbed, 'name')) {
      result.name = obj.name;
    }
    if (obj.stack && !Object.prototype.hasOwnProperty.call(scrubbed, 'stack')) {
      result.stack = scrubPii(obj.stack);
    }
    return result;
  }

  if (Array.isArray(obj)) return obj.map(item => scrubObject(item, visited));

  // Only deep-scrub plain objects; leave class instances (Date, URL, Map, etc.) unchanged
  if (Object.getPrototypeOf(obj) !== Object.prototype) return obj;

  const record = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    out[key] = scrubObject(record[key], visited);
  }
  return out;
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
