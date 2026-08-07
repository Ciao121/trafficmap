import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildSetFiltersMessage,
  removeFilterByPort
} from '../filter-controls.js';
import {
  applyFilterSet,
  countFilteredPacket,
  matchesFilters,
  serializeFilters,
  validateFilters
} from '../src/filters.js';

test('removing a filter updates UI state and excludes it from the next payload', () => {
  const filters = [
    { port: 443, protocol: 'tcp', bytesIn: 10, bytesOut: 20 },
    { port: 53, protocol: 'udp', bytesIn: 30, bytesOut: 40 }
  ];

  const remaining = removeFilterByPort(filters, 443);

  assert.deepEqual(remaining, [filters[1]]);
  assert.deepEqual(buildSetFiltersMessage(remaining), {
    type: 'set_filters',
    filters: [{ port: 53, protocol: 'udp' }]
  });
});

test('the agent stops removed-only traffic and retains the remaining filter', () => {
  const state = { filters: [], filterCounters: new Map() };
  applyFilterSet(state, [
    { port: 443, protocol: 'tcp' },
    { port: 53, protocol: 'udp' }
  ]);
  countFilteredPacket(state, {
    localPort: 443,
    protocol: 'tcp',
    direction: 'in',
    bytes: 10
  });

  const payload = buildSetFiltersMessage(
    removeFilterByPort(serializeFilters(state), 443)
  );
  const result = validateFilters(payload.filters);
  applyFilterSet(state, result.filters);

  assert.equal(matchesFilters(state.filters, {
    localPort: 443,
    protocol: 'tcp'
  }), false);
  assert.equal(matchesFilters(state.filters, {
    localPort: 53,
    protocol: 'udp'
  }), true);
  assert.equal(state.filterCounters.has(443), false);
  assert.deepEqual(serializeFilters(state), [
    { port: 53, protocol: 'udp', bytesIn: 0, bytesOut: 0 }
  ]);
});

test('removing the final filter sends an empty set and restores all traffic', () => {
  const state = { filters: [], filterCounters: new Map() };
  applyFilterSet(state, [{ port: 443, protocol: 'tcp' }]);

  const payload = buildSetFiltersMessage(
    removeFilterByPort(serializeFilters(state), 443)
  );
  const result = validateFilters(payload.filters);
  applyFilterSet(state, result.filters);

  assert.deepEqual(payload, { type: 'set_filters', filters: [] });
  assert.equal(state.filterCounters.size, 0);
  assert.equal(matchesFilters(state.filters, {
    localPort: 22,
    protocol: 'tcp'
  }), true);
  assert.equal(matchesFilters(state.filters, {
    localPort: 53,
    protocol: 'udp'
  }), true);
});

test('filter statistics are anchored above the bottom-right map control', () => {
  const css = fs.readFileSync(
    new URL('../styles.css', import.meta.url),
    'utf8'
  );
  const rule = css.match(/\.active-filters\s*\{([^}]+)\}/)?.[1] || '';

  assert.match(rule, /right:\s*14px/);
  assert.match(rule, /bottom:\s*32px/);
  assert.doesNotMatch(rule, /left:/);
});
