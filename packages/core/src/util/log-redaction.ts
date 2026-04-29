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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scrubObject(obj: any, seen?: WeakSet<object>): any {
  if (typeof obj === 'string') return scrubPii(obj);
  if (obj === null || typeof obj !== 'object') return obj;

  const visited = seen ?? new WeakSet<object>();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  if (visited.has(obj)) return '[Circular]';
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  visited.add(obj);

  if (obj instanceof Error) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const scrubbed = Object.create(Object.getPrototypeOf(obj)) as Error;
    for (const key of Object.keys(obj)) {
      (scrubbed as unknown as Record<string, unknown>)[key] = scrubObject(
        (obj as unknown as Record<string, unknown>)[key],
        visited
      );
    }
    if (!Object.prototype.hasOwnProperty.call(scrubbed, 'message')) {
      scrubbed.message = scrubPii(obj.message);
    }
    if (!Object.prototype.hasOwnProperty.call(scrubbed, 'name')) {
      scrubbed.name = obj.name;
    }
    if (obj.stack && !Object.prototype.hasOwnProperty.call(scrubbed, 'stack')) {
      scrubbed.stack = scrubPii(obj.stack);
    }
    return scrubbed;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  if (Array.isArray(obj)) return obj.map(item => scrubObject(item, visited));

  // Only deep-scrub plain objects; leave class instances (Date, URL, Map, etc.) unchanged
  if (Object.getPrototypeOf(obj) !== Object.prototype) return obj;

  const out: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  for (const key of Object.keys(obj)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    out[key] = scrubObject(obj[key], visited);
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
