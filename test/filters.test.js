import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFilterSet,
  countFilteredPacket,
  filterKey,
  matchesFilters,
  serializeFilters,
  validateFilters
} from '../src/filters.js';

const createState = () => ({ filters: [], filterCounters: new Map() });

test('empty filters match all TCP and UDP traffic', () => {
  assert.equal(matchesFilters([], { localPort: 443, protocol: 'tcp' }), true);
  assert.equal(matchesFilters([], { localPort: 53, protocol: 'udp' }), true);
});

test('filters match exact port and protocol pairs', () => {
  const filters = [
    { port: 443, protocol: 'tcp' },
    { port: 53, protocol: 'udp' }
  ];
  assert.equal(matchesFilters(filters, { localPort: 443, protocol: 'tcp' }), true);
  assert.equal(matchesFilters(filters, { localPort: 443, protocol: 'udp' }), false);
  assert.equal(matchesFilters(filters, { localPort: 53, protocol: 'udp' }), true);
  assert.equal(matchesFilters(filters, { localPort: 53, protocol: 'tcp' }), false);
});

test('validation accepts the same port with different protocols', () => {
  const result = validateFilters([
    { port: 443, protocol: 'tcp' },
    { port: 443, protocol: 'udp' }
  ]);
  assert.equal(result.valid, true);
  assert.deepEqual(result.filters, [
    { port: 443, protocol: 'tcp' },
    { port: 443, protocol: 'udp' }
  ]);
});

test('validation rejects duplicate pairs and unsupported protocols', () => {
  assert.equal(validateFilters(null).valid, false);
  assert.equal(validateFilters([{ port: 0, protocol: 'tcp' }]).valid, false);
  assert.equal(validateFilters([{ port: 53, protocol: 'icmp' }]).valid, false);
  assert.equal(validateFilters([{ port: 53, protocol: 'both' }]).valid, false);
  assert.equal(validateFilters([
    { port: 443, protocol: 'tcp' },
    { port: 443, protocol: 'tcp' }
  ]).valid, false);
  assert.equal(validateFilters([
    { port: 443, protocol: 'udp' },
    { port: 443, protocol: 'udp' }
  ]).valid, false);
  assert.deepEqual(validateFilters([
    { port: '53', protocol: 'UDP' }
  ]).filters, [{ port: 53, protocol: 'udp' }]);
});

test('filter state is independent between WebSocket clients', () => {
  const first = createState();
  const second = createState();
  applyFilterSet(first, [{ port: 443, protocol: 'tcp' }]);
  applyFilterSet(second, [{ port: 443, protocol: 'udp' }]);
  countFilteredPacket(first, {
    localPort: 443,
    protocol: 'tcp',
    direction: 'in',
    bytes: 10
  });
  countFilteredPacket(second, {
    localPort: 443,
    protocol: 'udp',
    direction: 'out',
    bytes: 20
  });
  assert.deepEqual(serializeFilters(first), [
    { port: 443, protocol: 'tcp', bytesIn: 10, bytesOut: 0 }
  ]);
  assert.deepEqual(serializeFilters(second), [
    { port: 443, protocol: 'udp', bytesIn: 0, bytesOut: 20 }
  ]);
});

test('TCP and UDP counters on the same port remain independent', () => {
  const state = createState();
  applyFilterSet(state, [
    { port: 443, protocol: 'tcp' },
    { port: 443, protocol: 'udp' }
  ]);
  countFilteredPacket(state, {
    localPort: 443,
    protocol: 'tcp',
    direction: 'in',
    bytes: 10
  });
  countFilteredPacket(state, {
    localPort: 443,
    protocol: 'udp',
    direction: 'out',
    bytes: 20
  });
  assert.deepEqual(serializeFilters(state), [
    { port: 443, protocol: 'tcp', bytesIn: 10, bytesOut: 0 },
    { port: 443, protocol: 'udp', bytesIn: 0, bytesOut: 20 }
  ]);
});

test('removing TCP retains UDP counters on the same port', () => {
  const state = createState();
  applyFilterSet(state, [
    { port: 443, protocol: 'tcp' },
    { port: 443, protocol: 'udp' }
  ]);
  countFilteredPacket(state, {
    localPort: 443,
    protocol: 'udp',
    direction: 'in',
    bytes: 7
  });
  applyFilterSet(state, [{ port: 443, protocol: 'udp' }]);
  assert.deepEqual(serializeFilters(state), [
    { port: 443, protocol: 'udp', bytesIn: 7, bytesOut: 0 }
  ]);
  assert.equal(state.filterCounters.has(filterKey(443, 'tcp')), false);
});

test('removing UDP retains TCP counters on the same port', () => {
  const state = createState();
  applyFilterSet(state, [
    { port: 443, protocol: 'tcp' },
    { port: 443, protocol: 'udp' }
  ]);
  countFilteredPacket(state, {
    localPort: 443,
    protocol: 'tcp',
    direction: 'out',
    bytes: 9
  });
  applyFilterSet(state, [{ port: 443, protocol: 'tcp' }]);
  assert.deepEqual(serializeFilters(state), [
    { port: 443, protocol: 'tcp', bytesIn: 0, bytesOut: 9 }
  ]);
});

test('removing and re-adding TCP resets only its counter', () => {
  const state = createState();
  applyFilterSet(state, [
    { port: 443, protocol: 'tcp' },
    { port: 443, protocol: 'udp' }
  ]);
  countFilteredPacket(state, { localPort: 443, protocol: 'tcp', direction: 'in', bytes: 10 });
  countFilteredPacket(state, { localPort: 443, protocol: 'udp', direction: 'in', bytes: 20 });
  applyFilterSet(state, [{ port: 443, protocol: 'udp' }]);
  applyFilterSet(state, [
    { port: 443, protocol: 'udp' },
    { port: 443, protocol: 'tcp' }
  ]);
  assert.deepEqual(serializeFilters(state), [
    { port: 443, protocol: 'udp', bytesIn: 20, bytesOut: 0 },
    { port: 443, protocol: 'tcp', bytesIn: 0, bytesOut: 0 }
  ]);
});

test('removing the last pair returns to all-traffic mode', () => {
  const state = createState();
  applyFilterSet(state, [{ port: 443, protocol: 'tcp' }]);
  applyFilterSet(state, []);
  assert.equal(matchesFilters(state.filters, { localPort: 22, protocol: 'udp' }), true);
});
