import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GeoIpCache } from '../src/geoip-cache.js';

function fixture(content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trafficmap-geo-'));
  const file = path.join(root, 'nested', 'cache.json');
  if (content !== undefined) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
  return { file, config: { cacheFile: file, endpointTemplate: 'https://geo.invalid/{ip}', timeoutMs: 50, negativeCacheMinutes: 1 } };
}

test('loads an existing file and handles missing files and invalid JSON', () => {
  let item = fixture(JSON.stringify({ '8.8.8.8': { latitude: 1 } }));
  assert.equal(new GeoIpCache(item.config).cache.size, 1);
  item = fixture(); assert.equal(new GeoIpCache(item.config).cache.size, 0);
  item = fixture('{'); assert.doesNotThrow(() => new GeoIpCache(item.config));
});

test('handles cache hits, negative cache, and negative expiration', async () => {
  const item = fixture(); const cache = new GeoIpCache(item.config);
  cache.cache.set('a', { latitude: 1 });
  assert.deepEqual(await cache.lookup('a'), { latitude: 1 });
  cache.cache.set('b', { error: 'x', negativeUntil: Date.now() + 1000 });
  assert.equal((await cache.lookup('b')).error, 'x');
  cache.cache.set('c', { error: 'x', negativeUntil: Date.now() - 1 });
  cache.fetchLookup = async () => ({ latitude: 2 });
  assert.deepEqual(await cache.lookup('c'), { latitude: 2 });
});

test('deduplicates concurrent requests', async () => {
  const item = fixture(); const cache = new GeoIpCache(item.config); let calls = 0;
  cache.fetchLookup = async () => { calls += 1; await new Promise((resolve) => setImmediate(resolve)); return { latitude: 1 }; };
  const [a, b] = await Promise.all([cache.lookup('8.8.8.8'), cache.lookup('8.8.8.8')]);
  assert.equal(calls, 1); assert.strictEqual(a, b);
});

test('handles successful fetches, HTTP errors, invalid payloads, and timeouts without network access', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const item = fixture(); const cache = new GeoIpCache(item.config);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ lat: '12.5', lon: '9.2', city: 'X' }) });
  assert.deepEqual(await cache.fetchLookup('8.8.8.8').then(({ latitude, longitude }) => ({ latitude, longitude })), { latitude: 12.5, longitude: 9.2 });
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  assert.match((await cache.fetchLookup('1.1.1.1')).error, /HTTP 503/);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ city: 'X' }) });
  assert.match((await cache.fetchLookup('9.9.9.9')).error, /valid coordinates/);
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  assert.equal((await cache.fetchLookup('4.4.4.4')).error, 'timeout');
});

test('persist creates the directory and uses an atomic temporary file', () => {
  const item = fixture(); const cache = new GeoIpCache(item.config);
  cache.cache.set('8.8.8.8', { latitude: 1 }); cache.dirty = true; cache.persist();
  assert.equal(JSON.parse(fs.readFileSync(item.file, 'utf8'))['8.8.8.8'].latitude, 1);
  assert.equal(fs.existsSync(`${item.file}.tmp`), false);
  assert.equal(cache.dirty, false);
});
