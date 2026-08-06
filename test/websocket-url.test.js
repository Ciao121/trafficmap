import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildWebSocketUrl } from '../websocket-url.js';

test('builds WSS from an HTTPS root page', () => {
  assert.equal(
    buildWebSocketUrl({
      protocol: 'https:',
      hostname: 'example.com',
      port: 3100,
      pathname: '/'
    }),
    'wss://example.com:3100/ws'
  );
});

test('a subdirectory does not affect the WebSocket path or port', () => {
  assert.equal(
    buildWebSocketUrl({
      protocol: 'https:',
      hostname: 'example.com',
      port: 3100,
      pathname: '/trafficmap/'
    }),
    'wss://example.com:3100/ws'
  );
});

test('builds WS from an HTTP page', () => {
  assert.equal(
    buildWebSocketUrl({
      protocol: 'http:',
      hostname: 'example.com',
      port: 3100
    }),
    'ws://example.com:3100/ws'
  );
});

test('supports IPv4 hostnames', () => {
  assert.equal(
    buildWebSocketUrl({
      protocol: 'https:',
      hostname: '192.0.2.10',
      port: 3100
    }),
    'wss://192.0.2.10:3100/ws'
  );
});

test('wraps IPv6 hostnames in square brackets', () => {
  assert.equal(
    buildWebSocketUrl({
      protocol: 'https:',
      hostname: '2001:db8::10',
      port: 3100
    }),
    'wss://[2001:db8::10]:3100/ws'
  );

  assert.equal(
    buildWebSocketUrl({
      protocol: 'https:',
      hostname: '[2001:db8::10]',
      port: 3100
    }),
    'wss://[2001:db8::10]:3100/ws'
  );
});

test('uses a configured agent port different from the default', () => {
  assert.equal(
    buildWebSocketUrl({
      protocol: 'https:',
      hostname: 'example.com',
      port: 8443
    }),
    'wss://example.com:8443/ws'
  );
});

test('does not depend on pathname and contains no hard-coded domains', () => {
  const source = fs.readFileSync(
    new URL('../websocket-url.js', import.meta.url),
    'utf8'
  );

  assert.equal(source.includes('pathname'), false);
  assert.equal(source.includes('spadacenta.com'), false);
});
