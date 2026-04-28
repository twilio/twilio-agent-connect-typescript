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
