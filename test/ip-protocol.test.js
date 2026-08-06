import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateOrReserved, maskIp, normalizeIp } from '../src/ip-utils.js';
import { normalizeTimestamp, sendJson, shouldRecordIp, validateActivityWindow, validatePort } from '../src/protocol.js';

test('normalizes IPv4, IPv4-mapped IPv6, and zone identifiers', () => {
  assert.equal(normalizeIp(' 203.0.113.1 '), '203.0.113.1');
  assert.equal(normalizeIp('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(normalizeIp('fe80::1%eth0'), 'fe80::1');
  assert.equal(normalizeIp(''), '');
});

test('classifies private, reserved, public, and invalid addresses', () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '192.168.1.1', '127.0.0.1', '169.254.1.1', '198.18.0.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '2001:db8::1', 'bad']) assert.equal(isPrivateOrReserved(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPrivateOrReserved(ip), false, ip);
});

test('masks IPv4 and IPv6 addresses', () => {
  assert.equal(maskIp('8.8.4.4'), '8.8.4.x');
  assert.equal(maskIp('2001:4860:4860::8888'), '2001:4860:4860:0::/64');
});

test('privacy excludes configured and private IP addresses', () => {
  assert.equal(shouldRecordIp('8.8.8.8', { excludedIps: ['8.8.8.8'], excludePrivateIps: false }, isPrivateOrReserved), false);
  assert.equal(shouldRecordIp('10.0.0.1', { excludedIps: [], excludePrivateIps: true }, isPrivateOrReserved), false);
  assert.equal(shouldRecordIp('8.8.8.8', { excludedIps: [], excludePrivateIps: true }, isPrivateOrReserved), true);
});

test('validates activity windows and ports with fallbacks', () => {
  for (const value of [5, 10, 30, 60]) assert.equal(validateActivityWindow(value), value);
  assert.equal(validateActivityWindow(15), 5);
  assert.equal(validatePort(65535), 65535);
  for (const value of [0, 65536, 2.5, 'x']) assert.equal(validatePort(value), 443);
});

test('normalizes Unix timestamps and textual dates', () => {
  assert.equal(normalizeTimestamp(1_700_000_000), 1_700_000_000_000);
  assert.equal(normalizeTimestamp(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(normalizeTimestamp('2026-08-06T00:00:00Z'), Date.parse('2026-08-06T00:00:00Z'));
  assert.equal(normalizeTimestamp('invalid'), 0);
});

test('serializes only to open sockets and handles errors', () => {
  const sent = [];
  assert.equal(sendJson({ readyState: 1, send: (value) => sent.push(value) }, { type: 'viewer', ip: '8.8.8.8' }), true);
  assert.deepEqual(JSON.parse(sent[0]), { type: 'viewer', ip: '8.8.8.8' });
  assert.equal(sendJson({ readyState: 0, send: () => assert.fail() }, {}), false);
  let error = '';
  assert.equal(sendJson({ readyState: 1, send: () => { throw new Error('closed'); } }, {}, 1, (message) => { error = message; }), false);
  assert.match(error, /closed/);
});
