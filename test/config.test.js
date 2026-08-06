import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeDeep, loadConfig } from '../src/config.js';

function defaults() {
  return {
    monitor: { port: 443, interface: 'any' },
    dashboard: { snapshotIntervalMs: 1000, inactiveAfterSeconds: 60, forgetAfterMinutes: 10, recentWindowSeconds: 300, pulseWindowSeconds: 10, tls: { certificate: '/generic/cert', privateKey: '/generic/key' } },
    geoip: { cacheFile: './data/cache.json' }
  };
}

function fixture(override, mutateDefaults = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'servermap-config-'));
  const base = defaults(); mutateDefaults(base);
  fs.writeFileSync(path.join(root, 'config.example.json'), JSON.stringify(base));
  if (override !== undefined) fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(override));
  return { root, options: { projectRoot: root, configPath: path.join(root, 'config.json') } };
}

test('merge profondo conserva default e applica override', () => {
  assert.deepEqual(mergeDeep({ a: { b: 1, c: 2 }, d: 3 }, { a: { b: 9 } }), { a: { b: 9, c: 2 }, d: 3 });
});

test('carica default quando config locale non esiste e risolve la cache', () => {
  const { root, options } = fixture(undefined);
  const config = loadConfig(options);
  assert.equal(config.monitor.interface, 'any');
  assert.equal(config.geoip.cacheFile, path.resolve(root, 'data/cache.json'));
});

test('override locale converte porta e valori temporali', () => {
  const { options } = fixture({ monitor: { port: '8443' }, dashboard: { recentWindowSeconds: '30' } });
  const config = loadConfig(options);
  assert.equal(config.monitor.port, 8443);
  assert.equal(config.dashboard.recentWindowSeconds, 30);
  assert.equal(config.dashboard.pulseWindowSeconds, 10);
});

for (const port of [0, 65536, 1.5, 'no']) {
  test(`rifiuta monitor.port non valido: ${port}`, () => {
    const { options } = fixture({ monitor: { port } });
    assert.throws(() => loadConfig(options), /integer between 1 and 65535/);
  });
}

for (const key of ['snapshotIntervalMs', 'inactiveAfterSeconds', 'forgetAfterMinutes', 'recentWindowSeconds', 'pulseWindowSeconds']) {
  test(`rifiuta dashboard.${key} non positivo`, () => {
    const { options } = fixture({ dashboard: { [key]: 0 } });
    assert.throws(() => loadConfig(options), new RegExp(`dashboard\\.${key}`));
  });
}

test('richiede certificato e chiave TLS con errori comprensibili', () => {
  let item = fixture(undefined, (base) => { base.dashboard.tls.certificate = ''; });
  assert.throws(() => loadConfig(item.options), /dashboard\.tls\.certificate must be configured/);
  item = fixture(undefined, (base) => { base.dashboard.tls.privateKey = ''; });
  assert.throws(() => loadConfig(item.options), /dashboard\.tls\.privateKey must be configured/);
});
