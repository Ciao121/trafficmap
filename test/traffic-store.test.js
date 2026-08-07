import test from 'node:test';
import assert from 'node:assert/strict';
import { TrafficStore } from '../src/traffic-store.js';

const config = {
  privacy: { maskIp: false },
  dashboard: { recentWindowSeconds: 30, pulseWindowSeconds: 5, inactiveAfterSeconds: 10, forgetAfterMinutes: 1 },
  map: { initialZoom: 3 }
};
const geo = { latitude: 1, longitude: 2, city: 'X', region: '', country: 'Y', countryCode: 'YY', isp: '', asn: '' };
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('creates a client and aggregates bytes, packets, and buckets by direction', async () => {
  let calls = 0;
  const store = new TrafficStore(config, { lookup: async () => { calls += 1; return geo; } });
  const now = Date.now();
  await store.record('8.8.8.8', 'in', 10, 443, 'tcp', now);
  await store.record('8.8.8.8', 'out', 20, 443, 'tcp', now + 10);
  await flush();
  const client = [...store.clients.values()][0];
  assert.equal(calls, 1);
  assert.deepEqual({ bytesIn: client.bytesIn, bytesOut: client.bytesOut, packetsIn: client.packetsIn, packetsOut: client.packetsOut }, { bytesIn: 10, bytesOut: 20, packetsIn: 1, packetsOut: 1 });
  assert.equal(client.buckets.size, 1);
});

test('snapshot aggregates recent and pulse windows with the primary payload', async () => {
  const store = new TrafficStore(config, { lookup: async () => geo });
  const now = Date.now();
  await store.record('8.8.8.8', 'in', 5, 443, 'tcp', now - 20_000);
  await store.record('8.8.8.8', 'out', 7, 443, 'tcp', now - 2_000);
  await flush();
  const snapshot = store.snapshot({ name: 'S' }, 443);
  assert.equal(snapshot.type, 'snapshot');
  assert.equal(snapshot.totals.recentBytesIn, 5);
  assert.equal(snapshot.totals.recentBytesOut, 7);
  assert.equal(snapshot.clients[0].pulseBytesIn, 0);
  assert.equal(snapshot.clients[0].pulseBytesOut, 7);
  assert.equal(snapshot.config.monitoredPort, 443);
});

test('cleanup expires old buckets, forgets old clients, and retains valid clients', async () => {
  const store = new TrafficStore(config, { lookup: async () => geo });
  const now = Date.now();
  await store.record('8.8.8.8', 'in', 1, 443, 'tcp', now - 120_000);
  await store.record('1.1.1.1', 'in', 1, 443, 'tcp', now);
  store.cleanup(now);
  assert.equal([...store.clients.values()].some((client) => client.ip === '8.8.8.8'), false);
  assert.equal([...store.clients.values()].some((client) => client.ip === '1.1.1.1'), true);
});

test('handles positive, negative, and failed GeoIP lookups', async () => {
  const positive = new TrafficStore(config, { lookup: async () => geo });
  await positive.record('8.8.8.8', 'in', 1, 443); await flush();
  assert.equal([...positive.clients.values()][0].geo.latitude, 1);
  const negative = new TrafficStore(config, { lookup: async () => ({ error: 'missing' }) });
  await negative.record('8.8.4.4', 'in', 1, 443); await flush();
  assert.equal([...negative.clients.values()][0].geo, null);
  assert.equal([...negative.clients.values()][0].geoPending, false);
  const failed = new TrafficStore(config, { lookup: async () => { throw new Error('fail'); } });
  await failed.record('1.0.0.1', 'in', 1, 443); await flush();
  assert.equal([...failed.clients.values()][0].geoPending, false);
});

test('masks snapshots without changing the internal key', async () => {
  const store = new TrafficStore({ ...config, privacy: { maskIp: true } }, { lookup: async () => geo });
  await store.record('8.8.8.8', 'in', 1, 443); await flush();
  const client = [...store.clients.values()][0];
  assert.match(client.key, /8\.8\.8\.8$/);
  assert.equal(store.snapshot({}, 443).clients[0].ip, '8.8.8.x');
});

test('ignores invalid ports and protocols', async () => {
  const store = new TrafficStore(config, { lookup: async () => geo });
  await store.record('8.8.8.8', 'in', 1, 0);
  await store.record('8.8.8.8', 'in', 1, 443, 'icmp');
  assert.equal(store.clients.size, 0);
});

test('records and snapshots UDP bytes in both directions', async () => {
  const store = new TrafficStore(config, { lookup: async () => geo });
  await store.record('8.8.8.8', 'in', 11, 53, 'udp');
  await store.record('8.8.8.8', 'out', 13, 53, 'udp');
  await flush();
  const snapshot = store.snapshot({}, [{ port: 53, protocol: 'udp' }], '');
  assert.equal(snapshot.totals.bytesIn, 11);
  assert.equal(snapshot.totals.bytesOut, 13);
  assert.equal(snapshot.clients[0].protocol, 'udp');
});

test('filtered snapshots contain only the union of active filters', async () => {
  const store = new TrafficStore(config, { lookup: async () => geo });
  await store.record('8.8.8.8', 'in', 1, 443, 'tcp');
  await store.record('1.1.1.1', 'in', 2, 53, 'udp');
  await store.record('9.9.9.9', 'in', 4, 22, 'tcp');
  await flush();
  const filtered = store.snapshot({}, [{ port: 443, protocol: 'tcp' }, { port: 53, protocol: 'udp' }], '');
  assert.equal(filtered.totals.bytesIn, 3);
  assert.equal(filtered.clients.length, 2);
  const all = store.snapshot({}, [], '');
  assert.equal(all.totals.bytesIn, 7);
});
