import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPayloadBytes, parseEndpoint, parseTcpdumpLine, TcpdumpMonitor } from '../src/tcpdump-monitor.js';

const local = new Set(['192.0.2.10', '2001:db8::10']);

test('parsa endpoint IPv4 e IPv6 tcpdump', () => {
  assert.deepEqual(parseEndpoint('203.0.113.5.50123'), { ip: '203.0.113.5', port: 50123 });
  assert.deepEqual(parseEndpoint('2001:db8::20.443'), { ip: '2001:db8::20', port: 443 });
  assert.equal(parseEndpoint('invalid'), null);
});

test('estrae tcp N con precedenza e fallback length N', () => {
  assert.equal(extractPayloadBytes('tcp 42, length 99'), 42);
  assert.equal(extractPayloadBytes('flags [P.], length 17'), 17);
  assert.equal(extractPayloadBytes('ack only'), 0);
});

test('parsa traffico IPv4 entrata e uscita con porte', () => {
  assert.deepEqual(parseTcpdumpLine('IP 203.0.113.5.50123 > 192.0.2.10.443: tcp 42', local), { clientIp: '203.0.113.5', localPort: 443, remotePort: 50123, direction: 'in', protocol: 'tcp', bytes: 42 });
  assert.deepEqual(parseTcpdumpLine('IP 192.0.2.10.443 > 203.0.113.5.50123: tcp 99', local), { clientIp: '203.0.113.5', localPort: 443, remotePort: 50123, direction: 'out', protocol: 'tcp', bytes: 99 });
});

test('parsa IPv6 e ignora ACK, linee sconosciute e traffico non locale', () => {
  assert.equal(parseTcpdumpLine('IP6 2001:db8::20.50000 > 2001:db8::10.443: tcp 12', local)?.direction, 'in');
  assert.equal(parseTcpdumpLine('IP 203.0.113.5.1 > 192.0.2.10.443: length 0', local), null);
  assert.equal(parseTcpdumpLine('nonsense', local), null);
  assert.equal(parseTcpdumpLine('IP 203.0.113.5.1 > 198.51.100.2.2: tcp 1', local), null);
});

test('costruisce comando tcpdump con interfaccia e modalità sudo senza avvio', () => {
  let monitor = new TcpdumpMonitor({ tcpdumpPath: '/custom/tcpdump', interface: 'eth9', sudo: false }, () => {});
  assert.deepEqual(monitor.buildCommand(), { command: '/custom/tcpdump', arguments: ['-i', 'eth9', '-n', '-l', '-q', 'tcp'] });
  monitor = new TcpdumpMonitor({ tcpdumpPath: '/custom/tcpdump', interface: 'any', sudo: true }, () => {});
  assert.deepEqual(monitor.buildCommand(), { command: 'sudo', arguments: ['-n', '/custom/tcpdump', '-i', 'any', '-n', '-l', '-q', 'tcp'] });
});
