import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFilterSet, countFilteredPacket, matchesFilters, serializeFilters, validateFilters } from '../src/filters.js';

test('empty filters match all TCP and UDP traffic', () => {
  assert.equal(matchesFilters([], { localPort: 443, protocol: 'tcp' }), true);
  assert.equal(matchesFilters([], { localPort: 53, protocol: 'udp' }), true);
});

test('TCP, UDP, and both filters match only their union', () => {
  const filters = [{ port: 443, protocol: 'tcp' }, { port: 53, protocol: 'udp' }, { port: 8080, protocol: 'both' }];
  assert.equal(matchesFilters(filters, { localPort: 443, protocol: 'tcp' }), true);
  assert.equal(matchesFilters(filters, { localPort: 443, protocol: 'udp' }), false);
  assert.equal(matchesFilters(filters, { localPort: 53, protocol: 'udp' }), true);
  assert.equal(matchesFilters(filters, { localPort: 8080, protocol: 'tcp' }), true);
  assert.equal(matchesFilters(filters, { localPort: 8080, protocol: 'udp' }), true);
  assert.equal(matchesFilters(filters, { localPort: 22, protocol: 'tcp' }), false);
});

test('validates ports, protocols, duplicates, and malformed payloads', () => {
  assert.equal(validateFilters(null).valid, false);
  assert.equal(validateFilters([{ port: 0, protocol: 'tcp' }]).valid, false);
  assert.equal(validateFilters([{ port: 53, protocol: 'icmp' }]).valid, false);
  assert.equal(validateFilters([{ port: 53, protocol: 'tcp' }, { port: 53, protocol: 'udp' }]).valid, false);
  assert.deepEqual(validateFilters([{ port: '53', protocol: 'UDP' }]).filters, [{ port: 53, protocol: 'udp' }]);
});

test('filter state is independent between WebSocket clients', () => {
  const first = { filters: [], filterCounters: new Map() };
  const second = { filters: [], filterCounters: new Map() };
  applyFilterSet(first, [{ port: 443, protocol: 'tcp' }]);
  applyFilterSet(second, [{ port: 53, protocol: 'udp' }]);
  assert.equal(matchesFilters(first.filters, { localPort: 53, protocol: 'udp' }), false);
  assert.equal(matchesFilters(second.filters, { localPort: 53, protocol: 'udp' }), true);
});

test('removing the last filter returns to all-traffic mode', () => {
  const state = { filters: [], filterCounters: new Map() };
  applyFilterSet(state, [{ port: 443, protocol: 'tcp' }]);
  applyFilterSet(state, []);
  assert.equal(matchesFilters(state.filters, { localPort: 22, protocol: 'udp' }), true);
});

test('removing one filter retains the remaining filter', () => {
  const state = { filters: [], filterCounters: new Map() };
  applyFilterSet(state, [{ port: 443, protocol: 'tcp' }, { port: 53, protocol: 'udp' }]);
  applyFilterSet(state, [{ port: 53, protocol: 'udp' }]);
  assert.equal(matchesFilters(state.filters, { localPort: 443, protocol: 'tcp' }), false);
  assert.equal(matchesFilters(state.filters, { localPort: 53, protocol: 'udp' }), true);
});

test('counters accumulate IN and OUT without double counting both', () => {
  const state = { filters: [], filterCounters: new Map() };
  applyFilterSet(state, [{ port: 8080, protocol: 'both' }]);
  countFilteredPacket(state, { localPort: 8080, protocol: 'tcp', direction: 'in', bytes: 10 });
  countFilteredPacket(state, { localPort: 8080, protocol: 'udp', direction: 'out', bytes: 20 });
  countFilteredPacket(state, { localPort: 53, protocol: 'udp', direction: 'in', bytes: 99 });
  assert.deepEqual(serializeFilters(state), [{ port: 8080, protocol: 'both', bytesIn: 10, bytesOut: 20 }]);
});

test('removing and re-adding a filter resets its counters', () => {
  const state = { filters: [], filterCounters: new Map() };
  applyFilterSet(state, [{ port: 443, protocol: 'tcp' }]);
  countFilteredPacket(state, { localPort: 443, protocol: 'tcp', direction: 'in', bytes: 10 });
  applyFilterSet(state, []);
  applyFilterSet(state, [{ port: 443, protocol: 'tcp' }]);
  assert.equal(serializeFilters(state)[0].bytesIn, 0);
});
