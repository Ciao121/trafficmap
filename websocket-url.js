export function buildWebSocketUrl({
  protocol,
  hostname,
  port
}) {
  const socketProtocol =
    protocol === 'https:'
      ? 'wss:'
      : 'ws:';

  const unwrappedHostname =
    String(hostname || '')
      .replace(/^\[/, '')
      .replace(/\]$/, '');

  const formattedHostname =
    unwrappedHostname.includes(':')
      ? `[${unwrappedHostname}]`
      : unwrappedHostname;

  return `${socketProtocol}//${formattedHostname}:${port}/ws`;
}
