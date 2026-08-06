import net from 'node:net';

export function normalizeIp(ip) {
  if (!ip) return '';
  let value = String(ip).trim();
  if (value.startsWith('::ffff:')) value = value.slice(7);
  const zoneIndex = value.indexOf('%');
  if (zoneIndex !== -1) value = value.slice(0, zoneIndex);
  return value;
}

export function isPrivateOrReserved(ip) {
  const value = normalizeIp(ip);
  const version = net.isIP(value);
  if (!version) return true;

  if (version === 4) {
    const parts = value.split('.').map(Number);
    const [a, b] = parts;
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  const lower = value.toLowerCase();
  return (
    lower === '::' || lower === '::1' ||
    lower.startsWith('fc') || lower.startsWith('fd') ||
    lower.startsWith('fe8') || lower.startsWith('fe9') ||
    lower.startsWith('fea') || lower.startsWith('feb') ||
    lower.startsWith('ff') ||
    lower.startsWith('2001:db8:')
  );
}

export function maskIp(ip) {
  const value = normalizeIp(ip);
  if (net.isIPv4(value)) {
    const parts = value.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
  }
  if (net.isIPv6(value)) {
    const [left = '', right = ''] = value.split('::');
    const leftParts = left ? left.split(':') : [];
    const rightParts = right ? right.split(':') : [];
    const parts = value.includes('::')
      ? [...leftParts, ...Array(8 - leftParts.length - rightParts.length).fill('0'), ...rightParts]
      : leftParts;
    return `${parts.slice(0, 4).join(':')}::/64`;
  }
  return value;
}
