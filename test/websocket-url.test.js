import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildWebSocketUrl } from '../websocket-url.js';

test('costruisce WSS dalla root HTTPS', () => {
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

test('la sottocartella non influenza percorso o porta WebSocket', () => {
  assert.equal(
    buildWebSocketUrl({
      protocol: 'https:',
      hostname: 'example.com',
      port: 3100,
      pathname: '/servermap/'
    }),
    'wss://example.com:3100/ws'
  );
});

test('costruisce WS da una pagina HTTP', () => {
  assert.equal(
    buildWebSocketUrl({
      protocol: 'http:',
      hostname: 'example.com',
      port: 3100
    }),
    'ws://example.com:3100/ws'
  );
});

test('supporta hostname IPv4', () => {
  assert.equal(
    buildWebSocketUrl({
      protocol: 'https:',
      hostname: '192.0.2.10',
      port: 3100
    }),
    'wss://192.0.2.10:3100/ws'
  );
});

test('racchiude correttamente hostname IPv6 tra parentesi quadre', () => {
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

test('usa una porta agent configurata diversa dal valore predefinito', () => {
  assert.equal(
    buildWebSocketUrl({
      protocol: 'https:',
      hostname: 'example.com',
      port: 8443
    }),
    'wss://example.com:8443/ws'
  );
});

test('non dipende dal pathname e non contiene domini hard-coded', () => {
  const source = fs.readFileSync(
    new URL('../websocket-url.js', import.meta.url),
    'utf8'
  );

  assert.equal(source.includes('pathname'), false);
  assert.equal(source.includes('spadacenta.com'), false);
});
