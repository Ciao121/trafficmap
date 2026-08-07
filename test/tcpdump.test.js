import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPayloadBytes, extractProtocol, parseEndpoint, parseTcpdumpLine, TcpdumpMonitor } from '../src/tcpdump-monitor.js';

const local = new Set(['192.0.2.10', '2001:db8::10']);

test('parses IPv4 and IPv6 tcpdump endpoints', () => {
  assert.deepEqual(parseEndpoint('203.0.113.5.50123'), { ip: '203.0.113.5', port: 50123 });
  assert.deepEqual(parseEndpoint('2001:db8::20.443'), { ip: '2001:db8::20', port: 443 });
  assert.equal(parseEndpoint('invalid'), null);
});

test('extracts tcp N with precedence and falls back to length N', () => {
  assert.equal(extractPayloadBytes('tcp 42, length 99'), 42);
  assert.equal(extractPayloadBytes('flags [P.], length 17'), 17);
  assert.equal(extractPayloadBytes('ack only'), 0);
});

test('parses inbound and outbound IPv4 traffic with ports', () => {
  assert.deepEqual(parseTcpdumpLine('IP 203.0.113.5.50123 > 192.0.2.10.443: tcp 42', local), { clientIp: '203.0.113.5', localPort: 443, remotePort: 50123, direction: 'in', protocol: 'tcp', bytes: 42 });
  assert.deepEqual(parseTcpdumpLine('IP 192.0.2.10.443 > 203.0.113.5.50123: tcp 99', local), { clientIp: '203.0.113.5', localPort: 443, remotePort: 50123, direction: 'out', protocol: 'tcp', bytes: 99 });
});

test('parses IPv6 and ignores ACKs, unknown lines, and non-local traffic', () => {
  assert.equal(parseTcpdumpLine('IP6 2001:db8::20.50000 > 2001:db8::10.443: tcp 12', local)?.direction, 'in');
  assert.equal(parseTcpdumpLine('IP 203.0.113.5.1 > 192.0.2.10.443: length 0', local), null);
  assert.equal(parseTcpdumpLine('nonsense', local), null);
  assert.equal(parseTcpdumpLine('IP 203.0.113.5.1 > 198.51.100.2.2: tcp 1', local), null);
});

test('parses inbound UDP IPv4 and outbound UDP IPv6', () => {
  assert.deepEqual(parseTcpdumpLine('IP 203.0.113.5.53000 > 192.0.2.10.53: UDP, length 42', local), { clientIp: '203.0.113.5', localPort: 53, remotePort: 53000, direction: 'in', protocol: 'udp', bytes: 42 });
  assert.deepEqual(parseTcpdumpLine('IP6 2001:db8::10.53 > 2001:db8::20.53000: UDP, length 77', local), { clientIp: '2001:db8::20', localPort: 53, remotePort: 53000, direction: 'out', protocol: 'udp', bytes: 77 });
  assert.equal(extractProtocol('UDP, length 5'), 'udp');
  assert.equal(extractProtocol('tcp 5'), 'tcp');
});

test('builds tcpdump commands with interface and sudo mode without starting a process', () => {
  let monitor = new TcpdumpMonitor({ tcpdumpPath: '/custom/tcpdump', interface: 'eth9', sudo: false }, () => {});
  assert.deepEqual(monitor.buildCommand(), { command: '/custom/tcpdump', arguments: ['-i', 'eth9', '-n', '-l', '-q', 'tcp', 'or', 'udp'] });
  monitor = new TcpdumpMonitor({ tcpdumpPath: '/custom/tcpdump', interface: 'any', sudo: true }, () => {});
  assert.deepEqual(monitor.buildCommand(), { command: 'sudo', arguments: ['-n', '/custom/tcpdump', '-i', 'any', '-n', '-l', '-q', 'tcp', 'or', 'udp'] });
});
